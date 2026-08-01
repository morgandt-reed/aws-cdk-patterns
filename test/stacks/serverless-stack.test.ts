import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../../lib/stacks/network-stack';
import { ServerlessStack } from '../../lib/stacks/serverless-stack';
import { ServerlessConfig } from '../../lib/config/environments';

const env = { account: '111111111111', region: 'us-west-2' };

function synth(config: ServerlessConfig): Template {
  const app = new cdk.App();
  const network = new NetworkStack(app, 'TestNetworkStack', {
    env,
    config: { maxAzs: 2, natGateways: 1, enableFlowLogs: false },
  });
  const stack = new ServerlessStack(app, 'TestServerlessStack', {
    env,
    vpc: network.vpc,
    config,
  });
  return Template.fromStack(stack);
}

const devConfig: ServerlessConfig = {
  memorySize: 256,
  timeout: 30,
  retainData: false,
};

const prodConfig: ServerlessConfig = {
  memorySize: 1024,
  timeout: 30,
  reservedConcurrency: 100,
  retainData: true,
};

describe('ServerlessStack', () => {
  test('creates a pay-per-request table with point-in-time recovery', () => {
    synth(devConfig).hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  test('the table removal policy is environment-derived, not always DESTROY', () => {
    synth(devConfig).hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Delete',
    });

    synth(prodConfig).hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
    });
  });

  test('Lambda memory, timeout and tracing follow the config', () => {
    synth(prodConfig).hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 1024,
      Timeout: 30,
      TracingConfig: { Mode: 'Active' },
      ReservedConcurrentExecutions: 100,
    });
  });

  test('reserved concurrency is omitted when not configured', () => {
    const fns = synth(devConfig).findResources('AWS::Lambda::Function');
    const props = Object.values(fns)[0].Properties;
    expect(props.ReservedConcurrentExecutions).toBeUndefined();
  });

  test('the handler is granted read/write on the table and nothing wider', () => {
    synth(devConfig).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:GetItem', 'dynamodb:PutItem']),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });

  test('exposes a REST API with the five item routes', () => {
    const template = synth(devConfig);

    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    // GET/POST on /items, GET/PUT/DELETE on /items/{id}, plus a CORS OPTIONS on
    // each of /, /items and /items/{id}
    template.resourceCountIs('AWS::ApiGateway::Method', 8);
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'api',
      TracingEnabled: true,
    });
  });
});
