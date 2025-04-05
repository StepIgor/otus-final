**Порядок установки (Kubernetes + Helm, namespace любой свой)**
1. Разворачивание БД сервисов (PostgreSQL)
```
helm install users-postgresql bitnami/postgresql -f values/postgresql_common_values.yaml
helm install users-redis bitnami/redis -f values/redis_common_values.yaml
```
2. Применение Kubernetes-манифестов (секреты, миграция, конфиги, деплои и сервисы)
```
kubectl apply -f manifests/
```
3. Установка NGINX Gateway из своего helm-чарта
```
helm install nginx-gateway src/gateway
```