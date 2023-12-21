import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';

export interface DatadogEcsLogsProps {
    /**
     * Whether logging should be enabled
     *
     * @default false
     */
    readonly enabled?: boolean;
    /**
     * Whether to collect from all containers
     *
     * @default true
     */
    readonly collectFromAllContainers?: boolean;
    /**
     * Collect logs from the agent container itself
     *
     * @default false
     */
    readonly collectFromAgentContainer?: boolean;
}

export interface DatadogEcsDaemonServiceProps {
    /**
     * The ECS cluster to deploy the Datadog agent to
     */
    readonly ecsCluster: ecs.Cluster;
    /**
     * The secret containing the Datadog API key
     */
    readonly datadogApiKeySecret: ecs.Secret;
    /**
     * The Datadog site to send data to
     *
     * @remarks
     * Defaults to datadoghq.com See information about other
     * datadog site parameters at
     * https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site
     */
    readonly datadogSite?: string;
    readonly logs?: DatadogEcsLogsProps;
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
    /**
     * The image to use for the container
     *
     * @default ecs.ContainerImage.fromRegistry('public.ecr.aws/datadog/agent:latest')
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
     * Whether the agent's logs should be sent to CloudWatch
     *
     * @default false
     */
    readonly logToCloudWatch?: boolean;
    /**
     * Whether to disable the agent's healthcheck
     *
     * @default false
     */
    readonly disableHealthcheck?: boolean;
}

/**
 * Deploys the Datadog agent as a daemon service to an ECS cluster.
 *
 * @remarks
 *
 * This construct is intended to be used with an ECS cluster makes use
 * of EC2 instances. It is not intended to be used with an ECS cluster
 * that only runs Fargate tasks. See addDatadogToFargateTask for retrieving
 * logs and metrics from Fargate tasks.
 */
export class DatadogEcsDaemonService extends Construct {
    readonly service: ecs.Ec2Service;

    constructor(scope: Construct, id: string, props: DatadogEcsDaemonServiceProps) {
        super(scope, id);

        // To match as documented at
        // https://docs.datadoghq.com/containers/amazon_ecs/?tab=awscli#setup
        // and
        // https://docs.datadoghq.com/containers/amazon_ecs/logs/?tab=linux
        const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDefinition', {
            family: 'datadog-agent-task',
        });

        const container = taskDefinition.addContainer('datadog-agent', {
            image: props.image ?? ecs.ContainerImage.fromRegistry(`public.ecr.aws/datadog/agent:${props.imageTag ?? 'latest'}`),
            cpu: props.cpu ?? 100,
            memoryLimitMiB: props.memoryLimitMiB ?? 512,
            essential: true,
            environment: {
                DD_SITE: props.datadogSite ?? 'datadoghq.com',
                ...(props.logs?.enabled
                    ? {
                          DD_LOGS_ENABLED: 'true',
                          DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL: props.logs.collectFromAllContainers !== false ? 'true' : 'false',
                          ...(!props.logs?.collectFromAgentContainer
                              ? {
                                    DD_CONTAINER_EXCLUDE: 'name:datadog-agent',
                                }
                              : {}),
                      }
                    : {}),
            },
            secrets: {
                DD_API_KEY: props.datadogApiKeySecret,
            },
            ...(props.disableHealthcheck
                ? {}
                : {
                      healthCheck: {
                          command: ['CMD-SHELL', 'agent health'],
                          retries: 3,
                          timeout: cdk.Duration.seconds(5),
                          interval: cdk.Duration.seconds(10),
                          startPeriod: cdk.Duration.seconds(15),
                      },
                  }),
            ...(props.logToCloudWatch
                ? {
                      logging: ecs.LogDrivers.awsLogs({
                          streamPrefix: 'datadog-agent',
                      }),
                  }
                : {}),
        });
        container.addMountPoints(
            {
                containerPath: '/var/run/docker.sock',
                sourceVolume: 'docker_sock',
                readOnly: true,
            },
            {
                containerPath: '/host/sys/fs/cgroup',
                sourceVolume: 'cgroup',
                readOnly: true,
            },
            {
                containerPath: '/host/proc',
                sourceVolume: 'proc',
                readOnly: true,
            },
        );

        if (props.logs?.enabled) {
            container.addMountPoints(
                {
                    containerPath: '/opt/datadog-agent/run',
                    sourceVolume: 'pointdir',
                    readOnly: false,
                },
                {
                    containerPath: '/var/lib/docker/containers',
                    sourceVolume: 'containers_root',
                    readOnly: true,
                },
            );
        }

        taskDefinition.addVolume({
            name: 'docker_sock',
            host: {
                sourcePath: '/var/run/docker.sock',
            },
        });

        taskDefinition.addVolume({
            name: 'proc',
            host: {
                sourcePath: '/proc/',
            },
        });

        taskDefinition.addVolume({
            name: 'cgroup',
            host: {
                sourcePath: '/sys/fs/cgroup/',
            },
        });

        if (props.logs?.enabled) {
            taskDefinition.addVolume({
                name: 'pointdir',
                host: {
                    sourcePath: '/opt/datadog-agent/run',
                },
            });

            taskDefinition.addVolume({
                name: 'containers_root',
                host: {
                    sourcePath: '/var/lib/docker/containers',
                },
            });
        }

        this.service = new ecs.Ec2Service(this, 'Service', {
            cluster: props.ecsCluster,
            taskDefinition,
            daemon: true,
        });
    }
}
