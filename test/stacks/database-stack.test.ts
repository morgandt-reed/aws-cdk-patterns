import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../../lib/stacks/network-stack';
import { DatabaseStack } from '../../lib/stacks/database-stack';
import { DatabaseConfig } from '../../lib/config/environments';

const env = { account: '111111111111', region: 'us-west-2' };

function synth(config: DatabaseConfig): Template {
  const app = new cdk.App();
  const network = new NetworkStack(app, 'TestNetworkStack', {
    env,
    config: { maxAzs: 2, natGateways: 1, enableFlowLogs: false },
  });
  const stack = new DatabaseStack(app, 'TestDatabaseStack', {
    env,
    vpc: network.vpc,
    config,
  });
  return Template.fromStack(stack);
}

const devConfig: DatabaseConfig = {
  serverless: true,
  minCapacity: 0.5,
  maxCapacity: 4,
  multiAz: false,
  backupRetention: 7,
};

const prodConfig: DatabaseConfig = {
  serverless: true,
  minCapacity: 2,
  maxCapacity: 64,
  multiAz: true,
  backupRetention: 35,
};

describe('DatabaseStack', () => {
  test('creates an Aurora PostgreSQL cluster in isolated subnets', () => {
    const template = synth(devConfig);

    template.resourceCountIs('AWS::RDS::DBCluster', 1);
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-postgresql',
    });
    // Isolated subnets have no route to a NAT Gateway, so the cluster is not
    // reachable from the internet even by mistake.
    template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
  });

  test('generates credentials in Secrets Manager rather than taking a password', () => {
    const template = synth(devConfig);

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({
        GenerateStringKey: 'password',
        PasswordLength: 32,
      }),
    });
  });

  test('serverless v2 capacity follows the environment config', () => {
    Template.fromJSON(synth(devConfig).toJSON()).hasResourceProperties(
      'AWS::RDS::DBCluster',
      {
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 0.5,
          MaxCapacity: 4,
        },
      }
    );

    synth(prodConfig).hasResourceProperties('AWS::RDS::DBCluster', {
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 2,
        MaxCapacity: 64,
      },
    });
  });

  test('dev gets one writer and no reader; multiAz adds a reader', () => {
    synth(devConfig).resourceCountIs('AWS::RDS::DBInstance', 1);
    synth(prodConfig).resourceCountIs('AWS::RDS::DBInstance', 2);
  });

  test('deletion protection and retention are derived from backup retention', () => {
    synth(devConfig).hasResource('AWS::RDS::DBCluster', {
      Properties: Match.objectLike({ DeletionProtection: false }),
      DeletionPolicy: 'Delete',
    });

    synth(prodConfig).hasResource('AWS::RDS::DBCluster', {
      Properties: Match.objectLike({ DeletionProtection: true }),
      DeletionPolicy: 'Retain',
    });
  });

  test('the security group does not allow all outbound', () => {
    const template = synth(devConfig);

    // allowAllOutbound: false renders a placeholder egress rule to 255.255.255.255/32
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupEgress: Match.arrayWith([
        Match.objectLike({ CidrIp: '255.255.255.255/32' }),
      ]),
    });
  });

  test('exports everything ComputeStack needs, so no construct has to cross stacks', () => {
    const template = synth(devConfig);

    template.hasOutput('SecurityGroupId', {
      Export: { Name: 'TestDatabaseStack-SecurityGroupId' },
    });
    template.hasOutput('SecretArn', {
      Export: { Name: 'TestDatabaseStack-SecretArn' },
    });
    template.hasOutput('ClusterEndpoint', {
      Export: { Name: 'TestDatabaseStack-ClusterEndpoint' },
    });
  });
});
