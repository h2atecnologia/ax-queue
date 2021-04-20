const ERROR_TEMPLATES = {
    timed_out: {
        code: 'TIMED_OUT',
    },
    uncaught_error: {
        code: 'UNCAUGHT_ERROR',
    },
    operation_error: {
        code: 'OPERATION_ERROR',
    },
    queue_full: {
        code: 'QUEUE_FULL',
    },
};

module.exports = class AXQueue {
    #id_counter = 0;
    #id_max = Number.MAX_SAFE_INTEGER;
    #queue = [];
    #queue_store = {};
    #active_operations = 0;
    #queued_operations = 0;
    #configuration = {
        max_concurrent: null,
        max_queued: null,
        max_queued_time: null,
        max_rate_limit: null,
    };

    constructor({
        max_concurrent_operations = Infinity,
        max_queued_operations = Infinity,
        max_queued_time_msecs = Infinity,
        max_rate_limit = {
            rate: Infinity,
            interval_msecs: Infinity,
        },
    }) {
        // Ensure parameters are number formats
        [max_concurrent_operations, max_queued_operations, max_queued_time_msecs].forEach((value) => {
            if (typeof value !== 'number')
                throw new Error(
                    'AXQueue: One of the parameters you have entered was an invalid data type. All parameters must be numbers.'
                );
        });

        // Store values to private configuration
        this.#configuration.max_concurrent = max_concurrent_operations;
        this.#configuration.max_queued = max_queued_operations;
        this.#configuration.max_queued_time = max_queued_time_msecs;

        // Parse & Store Max Limit
        if (typeof max_rate_limit == 'object') {
            let max_rate = max_rate_limit.rate;
            let max_interval_msecs = max_rate_limit.interval_msecs;

            if (!this._valid_number_parameter(max_rate))
                throw new Error('AXQueue: max_rate_limit.rate parameter must be a finite number greater than 0');

            if (!this._valid_number_parameter(max_interval_msecs))
                throw new Error('AXQueue: max_rate_limit.interval_msecs parameter must be a finite number greater than 0');

            if (!isFinite(max_rate) || !isFinite(max_interval_msecs)) return this;

            this.#configuration.max_rate_limit = {
                rate: max_rate,
                interval_msecs: max_interval_msecs,
                cycle_close: Date.now(),
                cycle_completed: 0,
            };
        }

        return this;
    }

    _valid_number_parameter(value) {
        return typeof value == 'number' && value > 0;
    }

    _id() {
        this.#id_counter++;
        if (this.#id_counter == this.#id_max) this.#id_counter = 0;
        return this.#id_counter;
    }

    _rate_limit_check() {
        if (this.#configuration.max_rate_limit == null) return 0;
        let configuration = this.#configuration.max_rate_limit;

        // Return remaining time till next limit cycle
        if (configuration.cycle_close > Date.now() && configuration.cycle_completed >= configuration.rate)
            return configuration.cycle_close - Date.now();

        // Reset cycle window if old one has expired
        if (configuration.cycle_close < Date.now()) {
            this.#configuration.max_rate_limit.cycle_close = Date.now() + this.#configuration.max_rate_limit.interval_msecs;
            this.#configuration.max_rate_limit.cycle_completed = 1;
        } else {
            this.#configuration.max_rate_limit.cycle_completed++;
        }

        return 0;
    }

    get queued_operations() {
        return this.#queued_operations;
    }

    get active_operations() {
        return this.#active_operations;
    }

    queue(operation) {
        if (typeof operation !== 'function') throw new Error('AXQueue: Instance.queue(operation) -> operation must be a function');
        let reference = this;
        return new Promise((resolve, reject) => {
            // Ensure there is space remaining in queue
            if (reference.#queued_operations >= reference.#configuration.max_queued) return reject(ERROR_TEMPLATES.queue_full);

            // Store queued item in queue store
            let position = reference._id();
            reference.#queue_store[position] = {
                rs: resolve,
                rj: reject,
                o: operation,
            };

            // Update queue statistics
            reference.#queued_operations++;
            reference.#queue.push(position);
            reference._perform_work();

            // Bind timeout for timed queues
            if (isFinite(reference.#configuration.max_queued_time)) {
                reference.#queue_store[position].t = setTimeout(
                    (context, pos) => {
                        // Ensure queued item still exists
                        if (context.#queue_store[pos]) {
                            context.#queued_operations--;
                            context.#queue_store[pos].rj(ERROR_TEMPLATES.timed_out);
                            delete context.#queue_store[pos];
                        }
                    },
                    reference.#configuration.max_queued_time,
                    reference,
                    position
                );
            }
        });
    }

    _perform_work(bypass_rate_limit = false) {
        // Enforce concurrency check
        let conn_check = this.#active_operations < this.#configuration.max_concurrent;
        if (!conn_check) return;

        // Enforce rate limit check & bind timeout for recalling _perform_work() method
        if (bypass_rate_limit === false) {
            let rate_limit_check = this._rate_limit_check();
            if (rate_limit_check > 0) {
                if (this.#active_operations == 0 && this.#queued_operations > 0)
                    return setTimeout((c) => c._perform_work(), rate_limit_check, this);
                return;
            }
        }

        // Retrieve candidate
        let position = this.#queue[0] + 0;
        let candidate = this.#queue_store[position];

        // Ensure candidate still exists
        if (candidate == undefined) return setImmediate(() => this._perform_work(true));

        // adjust queue statistics
        this.#active_operations++;
        this.#queued_operations--;
        this.#queue.shift();

        // Clear queue item timeout setTimeout
        if (candidate.t) clearTimeout(candidate.t);

        // Execute asynchronous operation
        let reference = this;
        new Promise(candidate.o)
            .then((p) => reference._finish_operation(reference, position, true, p))
            .catch((p) => reference._finish_operation(reference, position, false, p));
    }

    _finish_operation(reference, position, resolved, payload) {
        reference.#active_operations--;

        // Resolve initial promise made to queue caller
        if (resolved === true) {
            reference.#queue_store[position].rs(payload);
        } else {
            reference.#queue_store[position].rj({
                code: 'OPERATION_REJECT',
                error: payload,
            });
        }

        // Remove queued object from store and call _perform_work() for continuation
        delete reference.#queue_store[position];
        reference._perform_work();
    }
};
