import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../../lib/stacks/network-stack';
import { ComputeStack } from '../../lib/stacks/compute-stack';
import { EcsConfig } from '../../lib/config/environments';

const env = { account: '111111111111', region: 'us-west-2' };

function synth(config: EcsConfig): Template {
  const app = new cdk.App();
  const network = new NetworkStack(app, 'TestNetworkStack', {
    env,
    config: { maxAzs: 2, natGateways: 1, enableFlowLogs: false },
  });
  const stack = new ComputeStack(app, 'TestComputeStack', {
    env,
    vpc: network.vpc,
    config,
    databaseSecurityGroupId: 'sg-0123456789abcdef0',
    databaseEndpoint: 'db.example.internal',
    databasePort: 5432,
    databaseSecretArn:
      'arn:aws:secretsmanager:us-west-2:111111111111:secret:test/aurora/credentials-AbCdEf',
  });
  return Template.fromStack(stack);
}

const spotConfig: EcsConfig = {
  desiredCount: 1,
  cpu: 256,
  memory: 512,
  minCapacity: 1,
  maxCapacity: 4,
  useFargateSpot: true,
};

const onDemandConfig: EcsConfig = {
  desiredCount: 3,
  cpu: 1024,
  memory: 2048,
  minCapacity: 3,
  maxCapacity: 20,
  useFargateSpot: false,
};

describe('ComputeStack', () => {
  test('creates a Fargate service behind an internet-facing ALB', () => {
    const template = synth(spotConfig);

    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.resourceCountIs('AWS::ECS::Service', 1);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application',
    });
  });

  test('deployment circuit breaker rolls back a failed deployment', () => {
    synth(spotConfig).hasResourceProperties('AWS::ECS::Service', {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  test('capacity provider strategy follows useFargateSpot', () => {
    synth(spotConfig).hasResourceProperties('AWS::ECS::Service', {
      CapacityProviderStrategy: [
        { CapacityProvider: 'FARGATE_SPOT', Weight: 80 },
        { CapacityProvider: 'FARGATE', Weight: 20 },
      ],
    });

    synth(onDemandConfig).hasResourceProperties('AWS::ECS::Service', {
      CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE', Weight: 100 }],
    });
  });

  test('scales on both CPU and memory within the configured bounds', () => {
    const template = synth(onDemandConfig);

    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 3,
      MaxCapacity: 20,
    });
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalingPolicy', 2);
  });

  test('database credentials are injected from Secrets Manager, not baked in', () => {
    const template = synth(spotConfig);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'DB_USERNAME' }),
            Match.objectLike({ Name: 'DB_PASSWORD' }),
          ]),
        }),
      ]),
    });

    // The task definition must not contain a literal password anywhere
    expect(JSON.stringify(template.toJSON())).not.toMatch(/"DB_PASSWORD"\s*,\s*"Value"/);
  });

  test('the database ingress rule is created in this stack, not the database stack', () => {
    // This is the regression test for the DependencyCycle: the rule targets the
    // imported database security group by ID, so nothing in DatabaseStack has
    // to reference anything in ComputeStack.
    synth(spotConfig).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: 'sg-0123456789abcdef0',
      FromPort: 5432,
      ToPort: 5432,
      IpProtocol: 'tcp',
    });
  });
});
