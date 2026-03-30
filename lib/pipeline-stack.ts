import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface PipelineStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    // CodeBuild projects will run in private subnets (prod_Kubernetes)
    // props.vpc is available for CodeBuild VPC configuration
  }
}
