import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';

async function run() {
  const connection = await NativeConnection.connect({ address: 'localhost:7233' });

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'recoverable-activity',
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  console.log('Worker started, ctrl+c to exit');
  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
