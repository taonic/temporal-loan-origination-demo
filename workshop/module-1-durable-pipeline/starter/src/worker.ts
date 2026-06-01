// The worker is the process that actually runs your workflow and activity code.
// It long-polls the Temporal server for tasks on a task queue and executes them.
//
// You don't need to edit this file. Just remember: after changing any workflow
// or activity code, stop this process (Ctrl-C) and start it again.

import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';

export const TASK_QUEUE = 'loan-workshop';

async function run() {
  const connection = await NativeConnection.connect({ address: 'localhost:7233' });

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities: { ...activities },
  });

  console.log(`Worker started on task queue "${TASK_QUEUE}". Ctrl-C to exit.`);
  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
