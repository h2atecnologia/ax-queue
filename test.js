const HyperQueue = require('./index.js');
const TEST_QUEUE = new HyperQueue({
    max_concurrent_operations: 4,
    max_queued_operations: 40,
    max_rate_limit: {
        rate: 4,
        interval_msecs: 5000,
    },
});

for (let i = 0; i < 50; i++) {
    console.log('[Queued, Active]', TEST_QUEUE.queued_operations, TEST_QUEUE.active_operations);
    (async () => {
        let id = '#' + i + ' -> ' + Math.random().toString(36).substring(3) + Math.random().toString(36).substring(3);
        console.log('Queued Operation ' + id);
        let result = null;
        try {
            result = await TEST_QUEUE.queue((resolve, reject) => {
                console.log('Executing Operation' + id);
                console.log('[Queued, Active]', TEST_QUEUE.queued_operations, TEST_QUEUE.active_operations);
                setTimeout(
                    (rs, rj) => {
                        if (Math.random() < 0.5) {
                            rs('SOME_SUCCESS');
                        } else {
                            rj('SOME_ERROR');
                        }
                    },
                    Math.floor(Math.random() * 500),
                    resolve,
                    reject
                );
            });
        } catch (error) {
            console.log('Failed Operation ' + id + ': ');
            console.log(error);
            console.log('[Queued, Active]', TEST_QUEUE.queued_operations, TEST_QUEUE.active_operations);
            return;
        }

        console.log('Completed Operation ' + id);
        console.log(result);
        console.log('[Queued, Active]', TEST_QUEUE.queued_operations, TEST_QUEUE.active_operations);
    })();
}
