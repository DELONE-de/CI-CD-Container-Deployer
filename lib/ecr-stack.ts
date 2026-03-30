import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export class EcrStack extends cdk.Stack {
  public readonly repositoryUri: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const repo = new ecr.Repository(this, 'AppRepository', {
      repositoryName: 'container deployer',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.repositoryUri = repo.repositoryUri;

    new cdk.CfnOutput(this, 'RepositoryUri', { value: repo.repositoryUri });
  }
}
