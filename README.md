# datadog-ecs-cdk

Docs: https://isotoma.github.io/datadog-ecs-cdk/

NPM: https://www.npmjs.com/package/datadog-ecs-cdk

Source: https://github.com/isotoma/datadog-ecs-cdk

## EC2 example

```typescript
import { DatadogEcsDaemonService } from 'datadog-ecs-cdk';

// ...

new DatadogEcsDaemonService(this, 'EcsDatadog', {
    ecsCluster: myCluster,
    datadogApiKeySecret: ecs.Secret.fromSecretsManager(mySecret),
    // By default, when logs are enabled, collects logs from all containers,
    // but not the Datadog agent container itself.
    logs: {
        enabled: true,
    },
});
```

## Fargate example
```typescript
import { addDatadogToFargateTask } from 'datadog-ecs-cdk';

// ...

const myTaskDef = ...

addDatadogToFargateTask(myTaskDef, {
    datadogApiKeySecret: ecs.Secret.fromSecretsManager(mySecret),
    agent: {
        enabled: true,
        statsd: {
            enabled: true,
        },
    },
    fireLensLogging: {
        enabled: true,
        service: 'myservice',
        source: 'myservice',
    },
});
```
