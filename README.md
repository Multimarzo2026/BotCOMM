# BotCOMM

Bot de WhatsApp destinado a la automatización de la inserción de escuchas en la aplicación de MultiMarzo de Base44.

### Formatos de archivos ocultos

##### `config.json`

- Guarda los admins, el grupo del COMM y las variables de entorno de las APIs de streaming.
    - `"admins"`: IDs de WhatsApp de los usuarios de WhatsApp con permisos para reaccionar.
    - `"logGroupId"`: ID de WhatsApp del grupo del COMM.

```json
{
  "admins": [
    "12345678901234@lid", 
    "98765432109876543210@lid",
    // ...
  ],
  "logGroupId": "12345678901234@g.us",
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