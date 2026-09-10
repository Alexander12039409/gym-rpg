# Gym RPG → Telegram Mini App

Приложение уже умеет открываться как Mini App и синкать сейв через **CloudStorage бота**.
Это не «облако профиля Telegram» вообще, а хранилище **этот бот + твой аккаунт**.
С того же аккаунта на другом телефоне герой подтянется. Другой бот = другой сейв.

HTTPS обязан быть публичным. `file://` и `localhost` Telegram не примет.

---

## Что сделать тебе (без этого ссылку t.me не собрать)

### 1. Положить сайт в интернет (GitHub Pages)

На этом ПК Git не установлен, поэтому пуш отсюда не вышел. Поставь Git и залей **содержимое папки `gym-rpg-v4`** в корень публичного репозитория.

1. Установи [Git for Windows](https://git-scm.com/download/win). В установщике оставь «Git from the command line».
2. Заведи аккаунт на [github.com](https://github.com) если его нет.
3. Создай **публичный** репозиторий, например `gym-rpg`. Без README, если будешь пушить существующую папку.
4. В PowerShell:

```powershell
cd "E:\gym app\gym-rpg-v4"
git init -b main
git add .
git commit -m "Gym RPG Telegram Mini App"
git remote add origin https://github.com/ТВОЙ_НИК/gym-rpg.git
git push -u origin main
```

5. GitHub → репозиторий → **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main` / `/ (root)`
   - Save
6. Через минуту открой:
   `https://ТВОЙ_НИК.github.io/gym-rpg/`
   Должна открыться качалка. Если 404 — Pages ещё собирается, подожди.

Быстрее без Git: залей папку `gym-rpg-v4` на [Cloudflare Pages](https://pages.cloudflare.com) или Netlify Drop. Нужен любой **https://...** где лежит `index.html`.

### 2. Бот и Mini App в BotFather

Только ты, из своего Telegram. **Токен бота в чат ассистенту не кидай.**

1. Открой [@BotFather](https://t.me/BotFather)
2. `/newbot` — имя, например `Gym RPG`, username, например `gym_rpg_app_bot`
3. `/newapp` — выбери этого бота
4. Title: `Gym RPG`
5. Description: коротко, напр. `Качалка. Сет = удар по боссу.`
6. Картинка 640×360 (можно скрин из игры)
7. GIF можно пропустить (`/empty`)
8. **Web App URL** = твой HTTPS из шага 1, со слэшем в конце:
   `https://ТВОЙ_НИК.github.io/gym-rpg/`
9. Short name (латиница), например `app`  
   Ссылка будет: `https://t.me/gym_rpg_app_bot/app`

Готово: открой эту ссылку с телефона (и с другого, под тем же аккаунтом). Создай героя, закрой, зайди снова — сейв должен остаться.

### 3. Что прислать сюда, если что-то не открывается

- HTTPS URL страницы (GitHub Pages)
- username бота (`@...`)
- short name Mini App

Не присылай токен от BotFather.

---

## Как это хранится

- В Mini App: CloudStorage бота (куски `g8n` / `g8c0`…, лимит Telegram 4096 символов на ключ).
- Всегда дублируется в `localStorage` ключ `gymRpgV8` на этом устройстве.
- «Перерождение» чистит и локально, и облако бота.
