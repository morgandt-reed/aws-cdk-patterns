import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ServerlessConfig } from '../config/environments';

export interface ServerlessStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  config: ServerlessConfig;
}

/**
 * Serverless Stack - Lambda + API Gateway + DynamoDB
 */
export class ServerlessStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ServerlessStackProps) {
    super(scope, id, props);

    // DynamoDB Table
    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Environment-derived, like DatabaseStack. An unconditional DESTROY drops
      // the production table with the stack.
      removalPolicy: props.config.retainData
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    const handlerLogGroup = new logs.LogGroup(this, 'HandlerLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda function.
    //
    // This is a stub: it echoes the request and does not touch the DynamoDB
    // table it is granted access to. Replace the inline code with a
    // NodejsFunction bundling a real handler before using this for anything.
    const handler = new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Event:', JSON.stringify(event, null, 2));
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'Hello from Lambda!',
              path: event.path,
              method: event.httpMethod,
            }),
          };
        };
      `),
      memorySize: props.config.memorySize,
      timeout: cdk.Duration.seconds(props.config.timeout),
      environment: {
        TABLE_NAME: this.table.tableName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      tracing: lambda.Tracing.ACTIVE,
      logGroup: handlerLogGroup,
      reservedConcurrentExecutions: props.config.reservedConcurrency,
    });

    // Grant DynamoDB access
    this.table.grantReadWriteData(handler);

    // API Gateway
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${id}-api`,
      description: 'Serverless API',
      deployOptions: {
        stageName: 'api',
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // API resources
    const items = this.api.root.addResource('items');

    // GET /items
    items.addMethod('GET', new apigateway.LambdaIntegration(handler), {
      apiKeyRequired: false,
    });

    // POST /items
    items.addMethod('POST', new apigateway.LambdaIntegration(handler), {
      apiKeyRequired: false,
    });

    // GET /items/{id}
    const item = items.addResource('{id}');
    item.addMethod('GET', new apigateway.LambdaIntegration(handler));

    // PUT /items/{id}
    item.addMethod('PUT', new apigateway.LambdaIntegration(handler));

    // DELETE /items/{id}
    item.addMethod('DELETE', new apigateway.LambdaIntegration(handler));

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'API Gateway endpoint',
      exportName: `${id}-ApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name',
      exportName: `${id}-TableName`,
    });
  }
}
