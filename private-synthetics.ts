import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';

export interface DatadogPrivateSyntheticsServiceProps {
    readonly ecsCluster: ecs.Cluster;
    readonly datadogApiKeySecret: ecs.Secret;
    readonly datadogAccessKeySecret: ecs.Secret;
    readonly datadogSecretAccessKeySecret: ecs.Secret;
    readonly datadogPublicKeyPemSecret: ecs.Secret;
    readonly datadogPrivateKeySecret: ecs.Secret;
    readonly datadogSite?: string;
    readonly datadogLocationId: string;
    readonly datadogPublicKeyFingerprint: string;
    /**
     * The image to use for the container
     *
     * @default ecs.ContainerImage.fromRegistry('datadog/synthetics-private-location-worker:latest')
     */
    readonly image?: ecs.ContainerImage;
    /**
     * The image tag to use for the container
     *
     * @remarks
     * This is ignored if `image` is specified
     *
     * @default 'latest'
     */
    readonly imageTag?: string;
    /**
     * The number of CPU units to reserve for the container
     *
     * @default 100
     */
    readonly cpu?: number;
    /**
     * The amount (in MiB) of memory to present to the container
     *
     * @default 512
     */
    readonly memoryLimitMiB?: number;
}

abstract class DatadogPrivateSyntheticsBaseService extends Construct {
    protected getAddContainerDefinitionOptions(props: DatadogPrivateSyntheticsServiceProps): ecs.ContainerDefinitionOptions {
        return {
            image: props.image ?? ecs.ContainerImage.fromRegistry(`datadog/synthetics-private-location-worker:${props.imageTag ?? 'latest'}`),
            secrets: {
                DATADOG_API_KEY: props.datadogApiKeySecret,
                DATADOG_ACCESS_KEY: props.datadogAccessKeySecret,
                DATADOG_SECRET_ACCESS_KEY: props.datadogSecretAccessKeySecret,
                DATADOG_PUBLIC_KEY_PEM: props.datadogPublicKeyPemSecret,
                DATADOG_PRIVATE_KEY: props.datadogPrivateKeySecret,
            },
            environment: {
                DATADOG_SITE: props.datadogSite ?? 'datadoghq.com',
            },
            command: [`--locationID=${props.datadogLocationId}`, `--publicKey.fingerprint=${props.datadogPublicKeyFingerprint}`, '--enableStatusProbes', '--statusProbesPort=8080'],
            healthCheck: {
                retries: 3,
                command: ['CMD-SHELL', 'wget -O /dev/null http://localhost:8080/liveness || exit 1'],
                timeout: cdk.Duration.seconds(2),
                interval: cdk.Duration.seconds(10),
                startPeriod: cdk.Duration.seconds(30),
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'datadog-synthetics-private-location-worker',
            }),
        };
    }
}

export class DatadogPrivateSyntheticsFargateService extends DatadogPrivateSyntheticsBaseService {
    readonly service: ecs.FargateService;

    constructor(scope: Construct, id: string, props: DatadogPrivateSyntheticsServiceProps) {
        super(scope, id);

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
            cpu: props.cpu ?? 256,
            memoryLimitMiB: props.memoryLimitMiB ?? 512,
        });

        taskDefinition.addContainer('DatadogAgent', this.getAddContainerDefinitionOptions(props));

        this.service = new ecs.FargateService(this, 'Service', {
            cluster: props.ecsCluster,
            taskDefinition,
        });
    }
}

export class DatadogPrivateSyntheticsEc2Service extends DatadogPrivateSyntheticsBaseService {
    readonly service: ecs.Ec2Service;

    constructor(scope: Construct, id: string, props: DatadogPrivateSyntheticsServiceProps) {
        super(scope, id);

        const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDefinition');

        const containerProps = this.getAddContainerDefinitionOptions(props);

        taskDefinition.addContainer('DatadogAgent', {
            ...containerProps,
            cpu: props.cpu ?? 256,
            memoryLimitMiB: props.memoryLimitMiB ?? 512,
        });

        this.service = new ecs.Ec2Service(this, 'Service', {
            cluster: props.ecsCluster,
            taskDefinition,
        });
    }
}
