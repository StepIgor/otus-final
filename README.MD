**Порядок установки (Kubernetes + Helm, namespace любой свой)**
1. Разворачивание БД сервисов (PostgreSQL на каждый, общий Redis)
```
helm install users-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install billing-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install store-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install orders-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install library-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install common-redis bitnami/redis -f values/redis_common_values.yaml
```
2. Установка RabbitMQ
```
helm install rabbitmq bitnami/rabbitmq -f values/rabbitmq_common_values.yaml
```
3. Применение Kubernetes-манифестов (секреты, миграция, конфиги, деплои и сервисы)
```
kubectl apply -f manifests/
```
4. Подготовка SSL-сертификатов для NGINX Gateway
```
kubectl create secret tls nginx-tls --cert=arch.homework.pem --key=arch.homework-key.pem
```
5. Установка NGINX Gateway из своего helm-чарта
```
helm install nginx-gateway src/gateway
```
6. Проброс портов к Gateway для работы https (чтобы стоковый Ingress Minikube не делал подмену сертификата)
```
kubectl port-forward svc/gateway-service 8443:443
```