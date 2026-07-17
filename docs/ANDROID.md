# Android-приложение

Android-версия CreditCalc построена на Capacitor 8 и использует то же React-приложение и расчётное ядро, что веб-версия.

## Зафиксированные параметры

| Параметр | Значение |
| --- | --- |
| Название в RuStore | CreditCalc — кредитный график |
| Подпись под иконкой | CreditCalc |
| Application ID | `io.github.antm13.creditcalc` |
| Минимальная версия Android | Android 7.0, API 24 |
| Target/compile SDK | API 36 |
| Модель оплаты | Бесплатно |
| Реклама и аналитика | Отсутствуют |
| Основной формат релиза | Подписанный universal APK |

Application ID нельзя менять после первой публикации: магазин воспримет другой ID как новое приложение.

## Локальная разработка

Требуются Node.js 22, pnpm, JDK 21, Android Studio и Android SDK 36.

```bash
pnpm install
pnpm android:sync
pnpm android:open
```

`android:sync` собирает отдельный каталог `dist-android` без service worker и копирует его в нативный проект. Android Studio используется для запуска эмулятора, подключения устройства и просмотра Logcat.

Debug APK можно собрать командой:

```bash
pnpm android:apk:debug
```

Результат находится в `android/app/build/outputs/apk/debug/app-debug.apk`. Debug APK подписан отладочным ключом и не предназначен для GitHub Release или RuStore.

## Версии

Используется SemVer из `package.json`, а не дата выпуска. Gradle вычисляет `versionCode` автоматически:

```text
MAJOR * 1 000 000 + MINOR * 1 000 + PATCH
```

Текущий релиз `1.8.0` получает `versionCode 1008000`. Версию следует повышать только вместе с записью в `CHANGELOG.md` перед готовым релизом.

## Подпись релиза

Один release-ключ должен подписывать все APK для GitHub и RuStore, включая будущие обновления. Ключ создаётся один раз и хранится вне репозитория, с резервной копией в защищённом хранилище.

Пример создания после выбора паролей и данных владельца:

```bash
keytool -genkeypair -v -keystore creditcalc-release.jks -alias creditcalc -keyalg RSA -keysize 4096 -validity 10000
```

Файлы `*.jks` и `*.keystore` исключены из Git. Для workflow `.github/workflows/android-release.yml` нужны GitHub Secrets:

- `ANDROID_KEYSTORE_BASE64` — release-keystore в Base64;
- `ANDROID_KEYSTORE_PASSWORD` — пароль хранилища;
- `ANDROID_KEY_ALIAS` — alias ключа;
- `ANDROID_KEY_PASSWORD` — пароль ключа.

Workflow запускается вручную для существующего тега `vX.Y.Z`, проверяет исходники, собирает подписанный APK, формирует SHA-256 и прикрепляет оба файла к GitHub Release. Тот же APK загружается в RuStore.

## Хранение данных и разрешения

- расчёты хранятся локально в WebView-хранилище приложения;
- Android cloud backup отключён;
- широкое разрешение на файлы не запрашивается;
- разрешение `INTERNET` отсутствует;
- экспорт создаётся в кэше приложения и передаётся выбранному пользователем приложению через системное меню;
- чтение и запись буфера обмена выполняются через Capacitor Clipboard после действия пользователя;
- печать открывает системный Android Print Framework через локальный plugin `AndroidPrint`;
- аппаратная кнопка «Назад» сначала закрывает модальные окна, включая создание, переименование и удаление кредита, и меню, затем возвращает на обзор и только после этого сворачивает приложение;
- реклама, аналитические SDK, crash-reporting и Firebase не подключены.

Удаление приложения удалит его локальные данные. Для переноса или резервной копии пользователь должен экспортировать JSON.

## Подготовка к RuStore

Черновик карточки находится в [RUSTORE_LISTING.md](RUSTORE_LISTING.md), политика конфиденциальности — в [PRIVACY.md](../PRIVACY.md), пользовательское соглашение — в [TERMS.md](../TERMS.md).

Перед отправкой первой версии остаётся:

1. зарегистрировать и подтвердить кабинет разработчика RuStore;
2. создать release-ключ и настроить четыре GitHub Secret;
3. предоставить публичный email поддержки и данные правообладателя;
4. после merge дождаться release-тега `v1.8.0` и GitHub Release;
5. запустить `android-release.yml` для тега `v1.8.0`;
6. проверить подписанный APK на реальном устройстве и загрузить тот же файл в RuStore.

Шесть готовых скриншотов карточки находятся в `store-assets/rustore/screenshots`. Их состав и пересборка описаны в [RUSTORE_LISTING.md](RUSTORE_LISTING.md).
