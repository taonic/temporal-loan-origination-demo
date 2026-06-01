// Starts a loan-application workflow. Pick a scenario with an argument:
//
//   npx ts-node <this-dir>/client.ts            # clean application (default)
//   npx ts-node <this-dir>/client.ts bad-ssn    # credit check will fail
//
// You don't need to edit this file.

import { Connection, Client } from '@temporalio/client';
import { homeLoanWorkflow } from './workflows';
import { TASK_QUEUE } from './worker';
import type { LoanApplication } from './models';

const scenarios: Record<string, LoanApplication> = {
  clean: {
    applicationId: 'LOAN-001',
    applicantName: 'Alice Johnson',
    ssn: '123-45-6789',
    employerName: 'Acme Corp',
    annualIncome: 120000,
    propertyAddress: '123 Oak St, Springfield',
    propertyId: 'PROP-001',
    loanAmount: 350000,
    downPayment: 70000,
  },
  'bad-ssn': {
    applicationId: 'LOAN-002',
    applicantName: 'Bob Smith',
    ssn: '000-00-0000', // credit check rejects this — fix it with a `retry` signal
    employerName: 'TechCo',
    annualIncome: 95000,
    propertyAddress: '456 Elm Ave, Shelbyville',
    propertyId: 'PROP-002',
    loanAmount: 280000,
    downPayment: 56000,
  },
};

async function run() {
  const which = process.argv[2] || 'clean';
  const application = scenarios[which];
  if (!application) {
    console.error(`Unknown scenario "${which}". Options: ${Object.keys(scenarios).join(', ')}`);
    process.exit(1);
  }

  const connection = await Connection.connect({ address: 'localhost:7233' });
  const client = new Client({ connection });

  const handle = await client.workflow.start(homeLoanWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId: application.applicationId,
    args: [application],
  });

  console.log(`Started ${handle.workflowId} (${which})`);
  console.log(`Watch it at http://localhost:8233/namespaces/default/workflows/${handle.workflowId}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
