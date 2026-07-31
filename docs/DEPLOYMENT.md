# GitHub-деплой

Источник истины — GitHub. Сервер не редактируется вручную: изменения делаются в ветке, проходят проверку, затем попадают в `main`.

## Однократная настройка

На GitHub создайте пустой репозиторий и добавьте его как `origin` локально:

```bash
git remote set-url origin git@github.com:OWNER/REPOSITORY.git
git push -u origin main
```

На сервере один раз настройте тот же remote и ветку:

```bash
ssh bot
cd /opt/remnawave-STEALTHNET-Bot
git remote set-url origin git@github.com:OWNER/REPOSITORY.git
git fetch origin
tar -C /opt -czf /opt/remnawave-server-before-git.tar.gz \\
  --exclude=remnawave-STEALTHNET-Bot/.git \\
  --exclude=remnawave-STEALTHNET-Bot/.env \\
  remnawave-STEALTHNET-Bot
git checkout -B main origin/main
git clean -fd
```

Последние две команды выполняйте только после проверки backup: они убирают старый dirty working tree сервера. В текущем случае его содержимое уже сохранено в локальном коммите `85fbe85`.

SSH-ключ сервера должен иметь read-only deploy key в GitHub. `.env` остаётся только на сервере и не попадает в Git.

## Ежедневный цикл

```bash
git switch -c feat/short-description
# изменения и проверки
git add <files>
git commit -m "feat: short description"
git push -u origin HEAD
# merge в main через GitHub
DEPLOY_BRANCH=main scripts/deploy-to-bot.sh
```

Скрипт откажется работать при незакоммиченных изменениях на локальной машине или сервере, создаст backup, скачает `origin/main`, пересоберёт Compose и проверит health endpoint.

Для безопасной проверки настройки без перезапуска:

```bash
scripts/deploy-to-bot.sh --dry-run
```
