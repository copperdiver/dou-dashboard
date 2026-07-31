# Развёртывание

Код на сервер не копируется — он приезжает внутри образов из GHCR.
Из репозитория нужны ровно два файла.

## Что скопировать

| Файл | Куда | Зачем |
|---|---|---|
| `docker-compose.prod.yml` | в рабочий каталог, как есть | описание стека |
| `.env.production.example` | туда же, **под именем `.env`** | значения окружения |

```
/opt/dou-dashboard/
├── docker-compose.prod.yml
└── .env
```

Всё остальное — исходники, `node_modules`, `drizzle/` — уже в образах.
Миграции лежат в образе воркера, их применяет сервис `dou-migrate`.

## Образы

```
ghcr.io/copperdiver/dou-dashboard-web
ghcr.io/copperdiver/dou-dashboard-worker
```

Имена выводятся из `github.repository` в workflow, отдельно нигде не
записаны. Образов два на три сервиса: `dou-worker` и `dou-migrate`
отличаются только командой запуска.

Пакеты приватные, как и репозиторий, поэтому сервер должен войти
в реестр. Нужен токен с правом `read:packages`:

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u <логин> --password-stdin
```

## Что заполнить в .env

Обязательны:

- `POSTGRES_PASSWORD` — пароль по умолчанию на сервере недопустим;
- `DOU_USER_AGENT` — с UA по умолчанию источник отвечает 403.

Без них `docker compose` откажется стартовать, а не поднимется с тихим
умолчанием.

Стоит проверить:

- `PUBLIC_HOST` — домен, по которому маршрутизирует Traefik; из него же
  собирается адрес для канонических ссылок и `hreflang`;
- `IMAGE_TAG` — `latest` берёт последнюю сборку основной ветки; для
  предсказуемых выкладок лучше тег релиза или полный sha коммита.

Ключи LLM не обязательны: без них причины отказа остаются с португальским
оригиналом и без категории.

## Сеть

Ingress — Traefik во внешней сети `proxy`, он же терминирует TLS
и получает сертификат (`certresolver=le`). Наружу не публикуется ни один
порт: `dou-web` только объявляет 3000 через `expose`, и до него Traefik
достаёт по внутренней сети.

Сеть `proxy` создаётся не этим файлом — она общая для проектов сервера.
Если её ещё нет:

```sh
docker network create proxy
```

Postgres и Redis в `proxy` не входят вовсе и снаружи недоступны.
Воркер тоже: наружу он ничего не отдаёт, только сам ходит в in.gov.br
и к провайдеру LLM.

## Запуск

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

## Обновление и откат

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

`dou-migrate` отработает первым и завершится; `dou-web` и `dou-worker`
стартуют только после его успешного выхода, поэтому гонки за схему нет.

Откат — правка `IMAGE_TAG` в `.env` и тот же `up -d`. Учтите: миграции
назад не откатываются, поэтому откат безопасен, пока предыдущая версия
переживает новую схему.

## Проверка после выкладки

```sh
docker compose -f docker-compose.prod.yml exec dou-web \
  node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"

curl -fsS https://dou.copperdiver.studio/api/health
docker compose -f docker-compose.prod.yml logs --tail=50 dou-worker
```

Раздел «Состояние» в интерфейсе показывает запуски насосов, долю ошибок
и расписание — по нему видно, что конвейер жив.
