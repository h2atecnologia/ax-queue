const HyperQueue = require('./index.js');
const TEST_QUEUE = new HyperQueue({
    max_concurrent_operations: 4,
});

for (let i = 0; i < 5000; i++) {
    (async () => {
        let id = '#' + i + ':' + Math.random().toString(36).substring(3) + Math.random().toString(36).substring(3);
        console.log('Queued Operation ' + id);
        let result = null;
        try {
            result = await TEST_QUEUE.queue((resolve, reject) => {
                console.log('Executing Operation' + id);
                console.log('[Queued, Active]', TEST_QUEUE.queued_operations, TEST_QUEUE.active_operations);
                setTimeout((rs, rj) => rs('SOME_SUCCESS'), Math.floor(Math.random() * 300), resolve, reject);
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
