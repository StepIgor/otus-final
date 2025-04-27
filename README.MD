**Порядок установки (Kubernetes + Helm, namespace любой свой)**

Собрано и опубликовано в Dockerhub под ARM64 (:arm) и AMD64 (:amd). В манифестах по умолчанию используется arm-вариант.

1. Разворачивание БД сервисов (PostgreSQL каждому, общий Redis), общий RabbitMQ (для асинхронного взаимодействия между сервисами), Swagger (для просмотра API-методов сервисов)

```bash
helm install users-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install billing-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install store-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install orders-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install library-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install notifications-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install social-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install common-redis bitnami/redis -f values/redis_common_values.yaml
helm install rabbitmq bitnami/rabbitmq -f values/rabbitmq_common_values.yaml
helm install swagger src/swagger
```

2. Применение Kubernetes-манифестов (секреты, миграция, конфиги, деплои и сервисы)

```bash
kubectl apply -f manifests/
```

3. Подготовка SSL-сертификатов для NGINX Gateway, его установка (вместо стокового Ingress Minikube, чтобы последний не делал подмену сертификата на дефолтный)

```bash
kubectl create secret tls nginx-tls --cert=arch.homework.pem --key=arch.homework-key.pem
helm install nginx-gateway src/gateway
```

4. Установка зависимостей Front SPA и запуск веб-клиента (http://localhost:5173)

```bash
yarn --cwd src/svelte-spa install
yarn --cwd src/svelte-spa dev
```

5. Установка Prometheus + Grafana
```bash
helm install prometheus prometheus-community/prometheus -f values/prometheus_values.yaml
helm install grafana grafana/grafana
kubectl get secret grafana -o jsonpath="{.data.admin-password}" | base64 --decode ; echo
```

6. Проброс портов к NGINX Gateway, Swagger UI, Grafana (https://arch.homework:8443, http://localhost:8080, http://localhost:8081) (каждую команду вызывать в отдельном терминале)

```bash
kubectl port-forward svc/gateway-service 8443:443
kubectl port-forward svc/swagger-ui 8080:80
kubectl port-forward svc/grafana 8081:80
```