import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { VpcConstruct } from '../../lib/constructs/vpc-construct';

const env = { account: '111111111111', region: 'us-west-2' };

describe('VpcConstruct', () => {
  test('defaults: 3 AZs, 1 NAT Gateway, flow logs on, 10.0.0.0/16', () => {
    const stack = new cdk.Stack(new cdk.App(), 'TestStack', { env });
    new VpcConstruct(stack, 'Vpc');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
    });
    // 3 AZs x 3 tiers
    template.resourceCountIs('AWS::EC2::Subnet', 9);
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
    template.resourceCountIs('AWS::EC2::FlowLog', 1);
  });

  test('natGateways: 0 creates none, which is the dev cost lever', () => {
    const stack = new cdk.Stack(new cdk.App(), 'TestStack', { env });
    new VpcConstruct(stack, 'Vpc', { maxAzs: 2, natGateways: 0 });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::EC2::EIP', 0);
  });

  test('flow logs can be disabled', () => {
    const stack = new cdk.Stack(new cdk.App(), 'TestStack', { env });
    new VpcConstruct(stack, 'Vpc', { maxAzs: 2, enableFlowLogs: false });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::FlowLog', 0);
  });

  test('a custom CIDR is honoured', () => {
    const stack = new cdk.Stack(new cdk.App(), 'TestStack', { env });
    new VpcConstruct(stack, 'Vpc', { maxAzs: 2, cidr: '172.31.0.0/16' });

    Template.fromStack(stack).hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '172.31.0.0/16',
    });
  });

  test('public subnets do not auto-assign public IPs', () => {
    const stack = new cdk.Stack(new cdk.App(), 'TestStack', { env });
    new VpcConstruct(stack, 'Vpc', { maxAzs: 2, enableFlowLogs: false });

    const subnets = Template.fromStack(stack).findResources('AWS::EC2::Subnet');
    for (const subnet of Object.values(subnets)) {
      expect(subnet.Properties.MapPublicIpOnLaunch).not.toBe(true);
    }
  });

  test('S3 and DynamoDB gateway endpoints are created (both are free)', () => {
    const stack = new cdk.Stack(new cdk.App(), 'TestStack', { env });
    new VpcConstruct(stack, 'Vpc', { maxAzs: 2, enableFlowLogs: false });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::VPCEndpoint', 2);
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      VpcEndpointType: 'Gateway',
    });
  });
});
