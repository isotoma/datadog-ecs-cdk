import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// Comments are to match tsdoc formatting
export interface EcsDatadogDaemonServiceProps {
    /**
     * The ECS cluster to deploy the Datadog agent to
     */
    readonly ecsCluster: ecs.Cluster;
    /**
     * The secret containing the Datadog API key
     *
     * @remarks
     * The secret must be a single value, not key-value pairs.
     */
    readonly datadogApiKeySecret: secretsmanager.ISecret;
    /**
     * The Datadog site to send data to
     *
     * @remarks
     * Defaults to datadoghq.com See information about other
     * datadog site parameters at
     * https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site
     */
    readonly datadogSite?: string;
    /**
     * Whether logging should be disabled
     */
    readonly logsDisabled?: boolean;
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
export class EcsDatadogDaemonService extends Construct {
    constructor(scope: Construct, id: string, props: EcsDatadogDaemonServiceProps) {
        super(scope, id);

        // To match as documented at
        // https://docs.datadoghq.com/containers/amazon_ecs/?tab=awscli#setup
        // and
        // https://docs.datadoghq.com/containers/amazon_ecs/logs/?tab=linux
        const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDefinition', {
            family: 'datadog-agent-task',
        });

        const container = taskDefinition.addContainer('datadog-agent', {
            image: ecs.ContainerImage.fromRegistry('public.ecr.aws/datadog/agent:latest'),
            cpu: 100,
            memoryLimitMiB: 512,
            essential: true,
            environment: {
                DD_SITE: props.datadogSite ?? 'datadoghq.com',
                ...(props.logsDisabled
                    ? {}
                    : {
                          DD_LOGS_ENABLED: 'true',
                          DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL: 'true',
                      }),
            },
            secrets: {
                DD_API_KEY: ecs.Secret.fromSecretsManager(props.datadogApiKeySecret),
            },
            healthCheck: {
                command: ['CMD-SHELL', 'agent health'],
                retries: 3,
                timeout: cdk.Duration.seconds(5),
                interval: cdk.Duration.seconds(10),
                startPeriod: cdk.Duration.seconds(15),
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'datadog-agent',
            }),
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

        if (!props.logsDisabled) {
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

        if (!props.logsDisabled) {
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

        new ecs.Ec2Service(this, 'Service', {
            cluster: props.ecsCluster,
            taskDefinition,
            daemon: true,
        });
    }
}

export interface DatadogFargateApmApplicationEnvVarsProps {
    /**
     * Whether to skip setting the environment variables
     * in the other containers in the task.

     * @remarks
     * By default, the other containers will have the default
     * environment variables set to allow sending traces
     * to the APM.
     *
     * @default false
     */
    doNotSet?: boolean;
    /**
     * The name of the environment variable to set to the
     * host of the Datadog agent
     *
     * @default DD_AGENT_HOST
     */
    apmHostEnvVarName?: string;
    /**
     * The name of the environment variable to set to the
     * port of the Datadog agent
     *
     * @default DD_TRACE_AGENT_PORT
     */
    apmPortEnvVarName?: string;
    /**
     * The name of the environment variable to set to enable
     * tracing in the application
     *
     * @default DD_TRACE_ENABLED
     */
    apmTraceEnabledEnvVarName?: string;
}

export interface DatadogFargateApmProps {
    /**
     * Whether the Datadog APM should be enabled within the agent
     *
     * @default false
     */
    enabled?: boolean;
    /**
     * Port on which the APM will listen for traces
     *
     * @default 8126
     */
    port?: number;
    applicationEnvVars?: DatadogFargateApmApplicationEnvVarsProps;
}

export interface DatadogFargateStatsdApplicationEnvVarsProps {
    /**
     * Whether to skip setting the environment variables
     * in the other containers in the task.
     *
     * @remarks
     * By default, the other containers will have the default
     * environment variables set to allow sending metrics
     * to the StatsD server.
     *
     * @default false
     */
    doNotSet?: boolean;
    /**
     * The name of the environment variable to set to the
     * host of the Datadog agent
     *
     * @default STATSD_HOST
     */
    statsdHostEnvVarName?: string;
    /**
     * The name of the environment variable to set to the
     * port of the Datadog agent
     *
     * @default STATSD_PORT
     */
    statsdPortEnvVarName?: string;
}

export interface DatadogFargateStatsdProps {
    /**
     * Whether the Datadog StatsD server should be enabled within the agent
     *
     * @default false
     */
    enabled?: boolean;
    /**
     * Port on which the StatsD server will listen for metrics
     *
     * @default 8125
     */
    port?: number;
    applicationEnvVars?: DatadogFargateStatsdApplicationEnvVarsProps;
}

export interface DatadogFargateAgentProps {
    /**
     * Whether the Datadog agent should be enabled
     *
     * @remarks
     * If this is not enabled, the agent will not be deployed to
     * the task. This is useful if you only want to use the
     * firelens logging configuration.
     *
     * @default false
     */
    enabled?: boolean;
    /**
     * The image to use for the Datadog agent
     *
     * @remarks
     * This is useful if you want to use a custom image for the
     * Datadog agent.
     *
     * @default ecs.ContainerImage.fromRegistry('public.ecr.aws/datadog/agent:latest')
     */
    image?: ecs.ContainerImage;
    /**
     * The tag to use for the Datadog agent image
     *
     * @remarks
     * This is useful if you want to use a custom image for the
     * Datadog agent. This will be ignored if setting `image`.
     *
     * @default latest
     */
    imageTag?: string;
    /**
     * The memory limit for the Datadog agent container
     *
     * @default 256
     */
    memoryLimitMiB?: number;
    /*
     * The CPU units to reserve for the Datadog agent container
     *
     * @default
     */
    cpu?: number;
    /**
     * Whether the Datadog agent should log to CloudWatch.
     *
     * @remarks
     * If this is enabled, the Datadog agent will log its
     * own output to CloudWatch. This is useful if you want to see
     * the logs to debug the Datadog agent.
     *
     * @default false
     */
    logToCloudWatch?: boolean;
    apm?: DatadogFargateApmProps;
    statsd?: DatadogFargateStatsdProps;
}

export interface DatadogFargateFirelensLoggingProps {
    /**
     * Whether the firelens logging configuration should be enabled
     *
     * @remarks
     * If this is not enabled, the firelens logging configuration
     * will not be deployed to the task. This is useful if you
     * only want to use the Datadog agent.
     *
     * @default false
     */
    enabled?: boolean;
    /**
     * The service name to include in the logs sent to Datadog
     *
     * @remarks
     * By default, this will be unset and the logs will be sent without
     * a service tag.
     */
    service?: string;
    /**
     * The source name to include in the logs sent to Datadog
     *
     * @remarks
     * By default, this will be unset and the logs will be sent without
     * a source tag.
     */
    source?: string;
    /**
     * Any additional tags to include in the logs sent to Datadog
     *
     * @remarks
     * By default, this will be unset and the logs will be sent without
     * any additional tags.
     */
    tags?: Record<string, string>;
    /**
     * The memory limit for the firelens logging container
     *
     * @default 256
     */
    memoryLimitMiB?: number;
    /**
     * The CPU units to reserve for the firelens logging container
     *
     * @remarks
     * By default, this will be unset and the firelens logging
     * container will be able to use all available CPU units.
     */
    cpu?: number;
    /**
     * The image to use for the firelens logging container
     *
     * @default ecs.ContainerImage.fromRegistry('public.ecr.aws/datadog/aws-for-fluent-bit:latest')
     */
    image?: ecs.ContainerImage;
    /**
     * The tag to use for the firelens logging container image
     *
     * @remarks
     * This is ignored if setting `image`.
     * @default latest
     */
    imageTag?: string;
}

export interface AddDatadogToFargateTaskProps {
    /**
     * The secret containing the Datadog API key
     *
     * @remarks
     * It is important that the value specified by this secret
     * doesn't have a newline at the end. Otherwise, the firelens
     * logging configuration will fail to send logs to Datadog. This
     * is an easy mistake to introduce when the source for the secret
     * is a secretsmanager Secret containing a single value, rather
     * than key-value pairs.
     */
    datadogApiKeySecret: ecs.Secret;
    /**
     * The Datadog site to send data to
     *
     * @remarks
     * Defaults to datadoghq.com See information about other
     * datadog site parameters at
     * https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site
     *
     * @default datadoghq.com
     */
    datadogSite?: string;
    agent?: DatadogFargateAgentProps;

    fireLensLogging?: DatadogFargateFirelensLoggingProps;
}

const formatTags = (tags: Record<string, string>): string => {
    const formattedTags = [];
    for (const [key, value] of Object.entries(tags)) {
        formattedTags.push(`${key}:${value}`);
    }
    return formattedTags.join(',');
};

/**
 * Adds the Datadog agent and firelens logging configuration to a Fargate task
 *
 * @remarks
 * This is intended to be used with a Fargate task. It is not
 * intended to be used with non-Fargate tasks. See
 * EcsDatadogDaemonService for deploying the Datadog agent to an ECS
 * cluster that makes use of EC2 instances.
 */
export const addDatadogToFargateTask = (task: ecs.TaskDefinition, props: AddDatadogToFargateTaskProps) => {
    const containerNames = [];
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const containers = task.containers;
    for (const container of containers) {
        containerNames.push(container.containerName);
    }

    if (props.agent?.enabled) {
        task.addContainer('datadog-agent', {
            image: props.agent?.image ?? ecs.ContainerImage.fromRegistry(`public.ecr.aws/datadog/agent:${props.agent?.imageTag ?? 'latest'}`),
            memoryLimitMiB: props.agent?.memoryLimitMiB ?? 256,
            ...(props.agent?.cpu
                ? {
                      cpu: props.fireLensLogging?.cpu,
                  }
                : {}),
            ...(props.agent?.logToCloudWatch
                ? {
                      logging: ecs.LogDrivers.awsLogs({
                          streamPrefix: 'datadog-agent',
                      }),
                  }
                : {}),
            environment: {
                ECS_FARGATE: 'true',
                DD_SITE: props.datadogSite ?? 'datadoghq.com',
                ...(props.agent?.apm?.enabled
                    ? {
                          DD_APM_ENABLED: 'true',
                          DD_APM_RECEIVER_PORT: String(props.agent?.apm?.port ?? '8126'),
                      }
                    : {
                          DD_APM_ENABLED: 'false',
                      }),
                ...(props.agent?.statsd?.enabled
                    ? {
                          DD_USE_DOGSTATSD: 'true',
                          DD_DOGSTATSD_PORT: String(props.agent?.statsd?.port ?? '8125'),
                      }
                    : {
                          DD_USE_DOGSTATSD: 'false',
                      }),
            },
            secrets: {
                DD_API_KEY: props.datadogApiKeySecret,
            },
        });

        if (props.agent?.apm?.enabled && props.agent?.apm?.applicationEnvVars?.doNotSet !== true) {
            for (const containerName of containerNames) {
                const container = task.findContainer(containerName);
                if (container) {
                    container.addEnvironment(props.agent?.apm.applicationEnvVars?.apmTraceEnabledEnvVarName ?? 'DD_TRACE_ENABLED', 'true');
                    container.addEnvironment(props.agent?.apm.applicationEnvVars?.apmHostEnvVarName ?? 'DD_AGENT_HOST', 'localhost');
                    container.addEnvironment(props.agent?.apm.applicationEnvVars?.apmPortEnvVarName ?? 'DD_TRACE_AGENT_PORT', String(props.agent?.apm?.port ?? '8126'));
                }
            }
        }

        if (props.agent?.statsd?.enabled && props.agent?.statsd?.applicationEnvVars?.doNotSet !== true) {
            for (const containerName of containerNames) {
                const container = task.findContainer(containerName);
                if (container) {
                    container.addEnvironment(props.agent?.statsd?.applicationEnvVars?.statsdHostEnvVarName ?? 'STATSD_HOST', 'localhost');
                    container.addEnvironment(props.agent?.statsd?.applicationEnvVars?.statsdPortEnvVarName ?? 'STATSD_PORT', String(props.agent?.statsd?.port ?? '8125'));
                }
            }
        }
    }

    if (props.fireLensLogging?.enabled) {
        task.addFirelensLogRouter('log_router', {
            image: props.fireLensLogging?.image ?? ecs.ContainerImage.fromRegistry(`public.ecr.aws/datadog/aws-for-fluent-bit:${props.fireLensLogging?.imageTag ?? 'latest'}`),
            memoryLimitMiB: props.fireLensLogging?.memoryLimitMiB ?? 256,
            ...(props.fireLensLogging?.cpu
                ? {
                      cpu: props.fireLensLogging?.cpu,
                  }
                : {}),
            firelensConfig: {
                type: ecs.FirelensLogRouterType.FLUENTBIT,
                options: {
                    enableECSLogMetadata: true,
                },
            },
        });

        const firelensLogDriver = ecs.LogDrivers.firelens({
            options: {
                Name: 'datadog',
                Host: `http-intake.logs.${props.datadogSite ?? 'datadoghq.com'}`,
                TLS: 'on',
                provider: 'ecs',
                dd_message_key: 'log',
                ...(props.fireLensLogging?.service
                    ? {
                          dd_service: props.fireLensLogging?.service,
                      }
                    : {}),
                ...(props.fireLensLogging?.source
                    ? {
                          dd_source: props.fireLensLogging?.source,
                      }
                    : {}),
                ...(props.fireLensLogging?.tags
                    ? {
                          dd_tags: formatTags(props.fireLensLogging?.tags),
                      }
                    : {}),
            },
            secretOptions: {
                apikey: props.datadogApiKeySecret,
            },
        });

        for (const containerName of containerNames) {
            const container = task.findContainer(containerName);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            container.logDriverConfig = firelensLogDriver.bind(container, container);
        }
    }
};
