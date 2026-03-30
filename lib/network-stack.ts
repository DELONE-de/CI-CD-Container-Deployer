import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'AppVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          mapPublicIpOnLaunch: true,
          cidrMask: 24,
        },
        {
          name: 'prod_Kubernetes',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Tag public subnets for external load balancers
    this.vpc.publicSubnets.forEach((subnet) => {
      cdk.Tags.of(subnet).add('kubernetes.io/role/elb', '1');
    });

    // Tag private subnets for internal load balancers
    this.vpc.privateSubnets.forEach((subnet) => {
      cdk.Tags.of(subnet).add('kubernetes.io/role/internal-elb', '1');
    });
  }
}
