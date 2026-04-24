import express from 'express';
import { Connection, Client } from '@temporalio/client';
import { defineSearchAttributeKey } from '@temporalio/common';
import { homeLoanWorkflow, retrySignal, cancelSignal, approvalSignal, getStateQuery } from './workflows';
import type { LoanApplication, RetryUpdate, LoanState, CancelRequest } from './models';

const LoanStatusKey = defineSearchAttributeKey('LoanStatus', 'KEYWORD');
const FailedActivityKey = defineSearchAttributeKey('FailedActivity', 'KEYWORD');

function queryWithTimeout(handle: any, query: any, ms = 3000): Promise<LoanState | null> {
  return Promise.race([
    handle.query(query) as Promise<LoanState>,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function listWorkflows(client: Client, query: string) {
  const workflows: any[] = [];
  const iterator = client.workflow.list({ query });

  for await (const wf of iterator) {
    const entry: any = {
      workflowId: wf.workflowId,
      runId: wf.runId,
      wfStatus: wf.status.name,
      loanStatus: wf.searchAttributes?.LoanStatus?.[0] ?? '',
      failedActivity: wf.searchAttributes?.FailedActivity?.[0] ?? '',
    };

    try {
      const handle = client.workflow.getHandle(wf.workflowId);
      if (wf.status.name === 'RUNNING') {
        entry.state = await queryWithTimeout(handle, getStateQuery);
      } else if (wf.status.name === 'COMPLETED') {
        const result = await handle.result();
        // Only use result if it's a LoanState object (not old string format)
        if (result && typeof result === 'object' && result.status) {
          entry.state = result;
        }
      }
    } catch {
      // workflow may have just completed or result unavailable
    }

    workflows.push(entry);
  }

  return workflows;
}

async function run() {
  const connection = await Connection.connect({ address: 'localhost:7233' });
  const client = new Client({ connection });

  const app = express();
  app.use(express.json());
  app.use(express.static('public'));

  // List all loan workflows with their current state (exclude terminated)
  app.get('/api/workflows', async (_req, res) => {
    try {
      const workflows = await listWorkflows(
        client,
        `TaskQueue = 'recoverable-activity' AND WorkflowType = 'homeLoanWorkflow' AND ExecutionStatus != 'Terminated'`
      );
      res.json({ workflows });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Search workflows by failed activity using visibility query
  app.get('/api/workflows/search', async (req, res) => {
    try {
      const { failedActivity, status } = req.query;
      const clauses = [`TaskQueue = 'recoverable-activity' AND WorkflowType = 'homeLoanWorkflow' AND ExecutionStatus != 'Terminated'`];
      if (failedActivity) {
        clauses.push(`FailedActivity = '${failedActivity}'`);
      }
      if (status) {
        clauses.push(`LoanStatus = '${status}'`);
      }

      const workflows = await listWorkflows(client, clauses.join(' AND '));
      res.json({ workflows });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get single workflow state
  app.get('/api/workflows/:workflowId', async (req, res) => {
    try {
      const handle = client.workflow.getHandle(req.params.workflowId);
      const state = await handle.query(getStateQuery);
      const desc = await handle.describe();
      res.json({
        workflowId: req.params.workflowId,
        wfStatus: desc.status.name,
        state,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Start a new loan workflow
  app.post('/api/workflows', async (req, res) => {
    try {
      const application = req.body as LoanApplication;
      const suffix = Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.random() * 36 | 0]).join('');
      const workflowId = `LOAN-${suffix}`;
      application.applicationId = workflowId;

      const handle = await client.workflow.start(homeLoanWorkflow, {
        taskQueue: 'recoverable-activity',
        workflowId,
        args: [application],
        typedSearchAttributes: [
          { key: LoanStatusKey, value: 'STARTED' },
          { key: FailedActivityKey, value: '' },
        ],
      });
      res.json({ success: true, workflowId: handle.workflowId });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Send retry signal with optional data fix (empty key = retry without patching)
  app.post('/api/workflows/:workflowId/fix', async (req, res) => {
    try {
      const { key, value } = req.body as RetryUpdate;
      const handle = client.workflow.getHandle(req.params.workflowId);
      await handle.signal(retrySignal, { key, value });
      const msg = key ? `Fix sent: ${key} = ${value}` : 'Retry signal sent';
      res.json({ success: true, message: msg });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Signal human approval — releases the workflow's final pause and completes it
  app.post('/api/workflows/:workflowId/approve', async (req, res) => {
    try {
      const handle = client.workflow.getHandle(req.params.workflowId);
      await handle.signal(approvalSignal);
      res.json({ success: true, message: 'Application approved' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Cancel an in-flight application — triggers saga compensation unwind
  app.post('/api/workflows/:workflowId/cancel', async (req, res) => {
    try {
      const { reason } = req.body as CancelRequest;
      const handle = client.workflow.getHandle(req.params.workflowId);
      await handle.signal(cancelSignal, { reason: reason || 'Cancelled by operator' });
      res.json({ success: true, message: 'Cancellation signal sent — rolling back' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.listen(3000, () => {
    console.log('Loan Origination Demo UI running on http://localhost:3000');
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
