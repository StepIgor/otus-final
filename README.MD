**Порядок установки (Kubernetes + Helm, namespace любой свой)**
1. Разворачивание БД сервисов (PostgreSQL на каждый, общий Redis)
```bash
helm install users-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install billing-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install store-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install orders-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install library-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install notifications-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install social-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install common-redis bitnami/redis -f values/redis_common_values.yaml
```
2. Установка RabbitMQ
```bash
helm install rabbitmq bitnami/rabbitmq -f values/rabbitmq_common_values.yaml
```
3. Применение Kubernetes-манифестов (секреты, миграция, конфиги, деплои и сервисы)
```bash
kubectl apply -f manifests/
```
4. Подготовка SSL-сертификатов для NGINX Gateway
```bash
kubectl create secret tls nginx-tls --cert=arch.homework.pem --key=arch.homework-key.pem
```
5. Установка NGINX Gateway из своего helm-чарта
```bash
helm install nginx-gateway src/gateway
```
6. Проброс портов к Gateway для работы https (чтобы стоковый Ingress Minikube не делал подмену сертификата)
```bash
kubectl port-forward svc/gateway-service 8443:443
```
7. Установка зависимостей Front SPA (веб-клиент)
```bash
cd src/svelte-spa
yarn #npm install
```
8. Запуск веб-клиента
```bash
yarn dev #npm run dev
```