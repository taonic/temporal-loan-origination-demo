import { Connection, Client } from '@temporalio/client';
import { defineSearchAttributeKey } from '@temporalio/common';
import { homeLoanWorkflow } from './workflows';
import type { LoanApplication } from './models';

const LoanStatusKey = defineSearchAttributeKey('LoanStatus', 'KEYWORD');
const FailedActivityKey = defineSearchAttributeKey('FailedActivity', 'KEYWORD');

const scenarios: { name: string; application: LoanApplication }[] = [
  {
    name: 'Clean — all activities pass',
    application: {
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
  },
  {
    name: 'Bad SSN — credit check fails',
    application: {
      applicationId: 'LOAN-002',
      applicantName: 'Bob Smith',
      ssn: '000-00-0000',
      employerName: 'TechCo',
      annualIncome: 95000,
      propertyAddress: '456 Elm Ave, Shelbyville',
      propertyId: 'PROP-002',
      loanAmount: 280000,
      downPayment: 56000,
    },
  },
  {
    name: 'Invalid address — appraisal fails',
    application: {
      applicationId: 'LOAN-003',
      applicantName: 'Carol Davis',
      ssn: '987-65-4321',
      employerName: 'HealthPlus',
      annualIncome: 105000,
      propertyAddress: 'INVALID_ADDRESS',
      propertyId: 'PROP-003',
      loanAmount: 320000,
      downPayment: 64000,
    },
  },
  {
    name: 'Missing property ID — title search fails',
    application: {
      applicationId: 'LOAN-004',
      applicantName: 'Dan Miller',
      ssn: '555-12-3456',
      employerName: 'EduStar',
      annualIncome: 88000,
      propertyAddress: '789 Pine Rd, Capital City',
      propertyId: 'MISSING',
      loanAmount: 250000,
      downPayment: 50000,
    },
  },
  {
    name: 'High DTI — underwriting fails',
    application: {
      applicationId: 'LOAN-005',
      applicantName: 'Eve Wilson',
      ssn: '111-22-3333',
      employerName: 'StartupXYZ',
      annualIncome: 45000,
      propertyAddress: '321 Birch Ln, Ogdenville',
      propertyId: 'PROP-005',
      loanAmount: 500000,
      downPayment: 10000,
    },
  },
  {
    name: 'Unknown employer — income verification fails',
    application: {
      applicationId: 'LOAN-006',
      applicantName: 'Frank Brown',
      ssn: '444-55-6666',
      employerName: 'UNKNOWN_EMPLOYER',
      annualIncome: 75000,
      propertyAddress: '654 Maple Dr, North Haverbrook',
      propertyId: 'PROP-006',
      loanAmount: 220000,
      downPayment: 44000,
    },
  },
  {
    name: 'Multi-issue — bad employer + invalid address + missing property ID',
    application: {
      applicationId: 'LOAN-007',
      applicantName: 'Grace Lee',
      ssn: '777-88-9999',
      employerName: 'UNKNOWN_EMPLOYER',
      annualIncome: 92000,
      propertyAddress: 'INVALID_ADDRESS',
      propertyId: 'MISSING',
      loanAmount: 300000,
      downPayment: 60000,
    },
  },
  {
    name: 'Multi-issue — bad SSN + high DTI',
    application: {
      applicationId: 'LOAN-008',
      applicantName: 'Henry Park',
      ssn: '000-00-0000',
      employerName: 'MegaCorp',
      annualIncome: 50000,
      propertyAddress: '55 River Rd, Brockway',
      propertyId: 'PROP-008',
      loanAmount: 480000,
      downPayment: 5000,
    },
  },
  {
    name: 'Multi-issue — bad employer + bad SSN + invalid address + high DTI',
    application: {
      applicationId: 'LOAN-009',
      applicantName: 'Irene Tanaka',
      ssn: '000-00-0000',
      employerName: 'UNKNOWN_EMPLOYER',
      annualIncome: 40000,
      propertyAddress: 'INVALID_ADDRESS',
      propertyId: 'PROP-009',
      loanAmount: 600000,
      downPayment: 5000,
    },
  },
  {
    name: 'Saga — OFAC hit at underwrite, auto-rolls back through credit/appraisal/title',
    application: {
      applicationId: 'LOAN-010',
      applicantName: 'Judy Reed',
      ssn: '999-12-3456',
      employerName: 'MegaBank',
      annualIncome: 140000,
      propertyAddress: '88 Cedar Ct, Capital City',
      propertyId: 'PROP-010',
      loanAmount: 420000,
      downPayment: 84000,
    },
  },
  {
    name: 'Saga — OFAC hit + stuck appraiser vendor during rollback (needs compensation fix)',
    application: {
      applicationId: 'LOAN-011',
      applicantName: 'Kevin Liu',
      ssn: '999-77-8888',
      employerName: 'DataCore',
      annualIncome: 125000,
      propertyAddress: 'APPRAISER_OFFLINE 42 Ridge Dr',
      propertyId: 'PROP-011',
      loanAmount: 380000,
      downPayment: 76000,
    },
  },
];

async function run() {
  const connection = await Connection.connect({ address: 'localhost:7233' });
  const client = new Client({ connection });

  const batch = Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.random() * 36 | 0]).join('');
  console.log(`Starting ${scenarios.length} loan workflows (batch ${batch})...\n`);

  for (const scenario of scenarios) {
    const workflowId = `${scenario.application.applicationId}-${batch}`;
    const application = { ...scenario.application, applicationId: workflowId };
    const handle = await client.workflow.start(homeLoanWorkflow, {
      taskQueue: 'recoverable-activity',
      workflowId,
      args: [application],
      typedSearchAttributes: [
        { key: LoanStatusKey, value: 'STARTED' },
        { key: FailedActivityKey, value: '' },
      ],
    });
    console.log(`Started: ${handle.workflowId} — ${scenario.name}`);
  }

  console.log('\nAll workflows started. Use the UI (npm run web) to monitor and fix failures.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
