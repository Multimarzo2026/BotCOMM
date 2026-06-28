# BotCOMM

Bot de WhatsApp destinado a la automatización de la inserción de escuchas en la aplicación de MultiMarzo de Base44.

### Formatos de archivos ocultos

##### `config.json`

- Guarda los admins, el grupo del COMM, el grupo principal del bot y las credenciales de las APIs de streaming.
    - `"admins"`: IDs de WhatsApp de los usuarios con permisos para reaccionar.
    - `"logGroupId"`: ID de WhatsApp del grupo del COMM.
    - `"mainGroupId"`: ID de WhatsApp del grupo principal del bot.
    - `"davidFalsoId"`: ID de WhatsApp asociado a David Falso para los controles especiales.
    - `"davidFalsoCooldownSec"`: Tiempo de espera en segundos entre ejecuciones relacionadas con David Falso.
    - `"spotifyClientId"`, `"spotifyClientSecret"`: credenciales de la API de Spotify.
    - `"youtubeApiKey"`: clave de la API de YouTube.

```json
{
  "admins": [
    "12345678901234@lid",
    "98765432109876543210@lid"
  ],
  "logGroupId": "12345678901234@g.us",
  "mainGroupId": "567890123456789@g.us",
  "davidFalsoId": "111111111111111@lid",
  "davidFalsoCooldownSec": 30,
  "spotifyClientId": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "spotifyClientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "youtubeApiKey": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

##### `whitelist.json`

- Asocia las IDs de los usuarios de WhatsApp a las IDs de los participantes de la aplicación de MultiMarzo en Base44.

```json
{
  "12345678901234@lid": "697abcxxxxxxxxxxxxxxxxxx",
  "98765432109876543210@lid": "697abcyyyyyyyyyyyyyyyyyy",
  //...
}
```

### Comandos disponibles

El bot responde a comandos que comienzan con `/` en los grupos configurados en el archivo de configuración.

- `/davidFalso`: comando público que muestra una frase aleatoria de David Falso desde el historial del grupo principal.
- `/info`: muestra la guía de uso y la lista de comandos disponibles.
- `/ping`: comprueba si el bot está en línea.
- `/version`: muestra información del estado del bot, incluyendo el último commit y la fecha de la última actualización.
- `/getTimeout`: consulta el cooldown actual del comando `/davidFalso` (solo admins).
- `/setTimeout <segs>`: modifica el cooldown de `/davidFalso` en tiempo real (solo admins).