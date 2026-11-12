# Português (Portugal) : textes de sécurité à faire relire

Les textes portugais d’Élise ont été traduits depuis le français vers le portugais européen (pt-PT, Acordo Ortográfico de 1990, registre de politesse à la 3ᵉ personne : « Selecione », « o seu familiar »). Comme le demande [traductions.md](traductions.md#règles-de-traduction), les textes liés à la sécurité doivent être relus par une personne de langue maternelle portugaise (idéalement du Portugal) avant d’être présentés à des familles lusophones.

Cette liste est une **sélection de 99 textes** parmi les catalogues complets (`mobile` : `translations/pt/mobile.json`, `web` : `translations/pt/web.json`, `landing` : `translations/pt/landing.json`), rangés par thème. Un texte n’apparaît qu’une fois, sous le premier thème qui le concerne. Les catalogues portugais sont, après `pnpm i18n:import pt`, dans `apps/mobile/src/i18n/locales/pt.json`, `apps/dashboard/src/i18n/locales/pt.json` et `eliselanding/src/i18n/locales/pt.json`.

Pour corriger un texte : modifier la valeur de la clé dans le catalogue du bloc, puis `pnpm i18n:check`.

Ce qui compte à la relecture :

- aucune formule alarmiste, aucun diagnostic (Élise relève des repères, elle ne conclut pas : « possível queda » et non « queda ») ;
- le 112 pour les urgences, et des consignes claires sur ce qu’Élise ne remplace pas (teleassistência, serviço de emergência, dispositivo médico) ;
- pt-PT strict : ecrã, telemóvel, fumo, fuga de água, palavra-passe, câmara, ligação, partilhar, guardar… (aucun brésilianisme, aucun gérondif : « A carregar… ») ;
- les messages préenregistrés d’un proche à la personne âgée restent au « tu » comme en français ; les autres textes sont à la 3ᵉ personne de politesse ;
- vocabulaire fixé : « assumir o alerta » (prise en charge), « botão de assistência », « acesso remoto », « privacidade », « caderno de ligação » ;
- politique de confidentialité : durées de conservation et mentions RGPD à faire vérifier (« responsável pelo tratamento » pour le responsable de traitement).

## Hors catalogues

- Fiche App Store : `apps/mobile/fastlane/metadata/pt-PT/` (`description.txt`, `promotional_text.txt` : possível queda, fumo, fuga de água, 112, dados em local).
- Documentation du site : `eliselanding/src/content/docs/pt/docs/` (en particulier `concepts/safety.md`, `concepts/privacy.md`, `start/remote-access.md`, `use/cameras.md`, `use/sensors.md`, `use/resident-screen.md`, `contribute/security.md`).
- README : `README.pt.md`.

## Chute (14)

- landing · `app.features.1.shot.alt`
  - FR : Écran des alertes : protections actives contre les chutes, la fumée et les fuites d’eau, et une porte d’entrée restée ouverte plus longtemps que d’habitude.
  - PT : Ecrã dos alertas: proteções ativas contra quedas, fumo e fugas de água, e uma porta de entrada que ficou aberta mais tempo do que o habitual.
- landing · `sensors.HS2FD-EF1-3.0.name`
  - FR : Détecteur de chute Zigbee
  - PT : Detetor de quedas Zigbee
- mobile · `dashboardApp.alertExplanation.possibleFall`
  - FR : Le détecteur signale une chute possible. Vérifiez rapidement que la personne va bien.
  - PT : O detetor assinala uma possível queda. Verifique rapidamente se a pessoa está bem.
- mobile · `dashboardApp.alertTitle.possibleFallDetected`
  - FR : Alerte de chute
  - PT : Alerta de queda
- mobile · `dashboardApp.fallDetection`
  - FR : Détection des chutes
  - PT : Deteção de quedas
- mobile · `dashboardApp.fallReported`
  - FR : Chute signalée
  - PT : Queda assinalada
- mobile · `dashboardApp.possibleFallReported`
  - FR : Chute possible signalée
  - PT : Possível queda assinalada
- mobile · `mobileSettingsPanel.fallsSmokeWaterLeaksAnd`
  - FR : Chutes, fumée, fuite d’eau et carnet de liaison.
  - PT : Quedas, fumo, fugas de água e caderno de ligação.
- mobile · `mobileSettingsPanel.whenAFallIsDetected`
  - FR : Lorsqu’une chute est détectée.
  - PT : Quando é detetada uma queda.
- mobile · `sensorProducts.heiman-fall-detection.preparation.3`
  - FR : Après l’installation, vérifiez la réception d’une alerte de chute avec le mode de test indiqué par le fabricant. Le modèle n’a pas encore été testé physiquement avec Élise.
  - PT : Após a instalação, verifique a receção de um alerta de queda com o modo de teste indicado pelo fabricante. Este modelo ainda não foi testado fisicamente com a Élise.
- web · `alertsPage.advice.FALL_DETECTION`
  - FR : Vérifiez rapidement que la personne va bien. Le signal peut être une chute possible : confirmez la situation sur place ou par appel.
  - PT : Verifique rapidamente se a pessoa está bem. O sinal pode indicar uma possível queda: confirme a situação no local ou por chamada.
- web · `alertsPage.explanationFor.safetyExplanations.FALL_DETECTION`
  - FR : Le détecteur signale une chute possible. Vérifiez rapidement que la personne va bien.
  - PT : O detetor assinala uma possível queda. Verifique rapidamente se a pessoa está bem.
- web · `alertsPage.possibleFallReported`
  - FR : Chute possible signalée
  - PT : Possível queda assinalada
- web · `scenario.theBathroomDetectorReportedA`
  - FR : Le détecteur de la salle de bains a signalé une chute possible. Jeanne avait laissé tomber une serviette ; fausse alerte.
  - PT : O detetor da casa de banho assinalou uma possível queda. A Jeanne tinha deixado cair uma toalha; falso alarme.

## Fumée (11)

- landing · `app.features.1.text`
  - FR : Pas de notification à chaque passage dans le couloir. Élise vous prévient pour ce qui compte : une chute détectée, de la fumée, une fuite d’eau, un appui sur le bouton d’appel ou une inactivité inhabituelle. Vous choisissez ce que vous voulez recevoir.
  - PT : Nada de notificações a cada passagem no corredor. A Élise avisa-o do que importa: uma possível queda, fumo, uma fuga de água, o botão de chamada premido ou uma inatividade fora do habitual. Escolhe o que quer receber.
- landing · `sensors.HS1SA-E.name`
  - FR : Détecteur de fumée intelligent Zigbee
  - PT : Detetor de fumo inteligente Zigbee
- landing · `setup.needs.options.smoke.text`
  - FR : Un détecteur de fumée certifié.
  - PT : Um detetor de fumo certificado.
- mobile · `dashboardApp.alertExplanation.smoke`
  - FR : Le détecteur de fumée s’est déclenché. Vérifiez rapidement la situation sans vous exposer au danger.
  - PT : O detetor de fumo disparou. Verifique rapidamente a situação sem se expor ao perigo.
- mobile · `dashboardApp.alertTitle.smokeDetected`
  - FR : Fumée détectée
  - PT : Fumo detetado
- mobile · `dashboardApp.smokeDetection`
  - FR : Détection de la fumée
  - PT : Deteção de fumo
- mobile · `mobileSettingsPanel.smokeDetection`
  - FR : Détection de fumée
  - PT : Deteção de fumo
- mobile · `mobileSettingsPanel.whenASensorDetectsSmoke`
  - FR : Lorsqu’un détecteur signale de la fumée.
  - PT : Quando um detetor assinala fumo.
- mobile · `sensorProducts.heiman-smoke-detector.preparation.5`
  - FR : Après l’installation, testez la sirène selon la notice et vérifiez l’état du détecteur et de sa batterie dans Élise. Zigbee2MQTT signale que certains firmwares peuvent envoyer de faux états fumée répétés ; surveillez son comportement après l’appairage.
  - PT : Após a instalação, teste a sirene de acordo com o manual e verifique o estado do detetor e da bateria na Élise. O Zigbee2MQTT indica que alguns firmwares podem enviar falsos estados de fumo repetidos; acompanhe o comportamento do detetor após o emparelhamento.
- web · `alertsPage.advice.SMOKE`
  - FR : Si de la fumée est présente, mettez-vous en sécurité et appelez les secours.
  - PT : Se houver fumo, coloque-se em segurança e ligue para os serviços de emergência.
- web · `alertsPage.explanationFor.safetyExplanations.SMOKE`
  - FR : Le détecteur de fumée s’est déclenché. Vérifiez rapidement la situation sans vous exposer au danger.
  - PT : O detetor de fumo disparou. Verifique rapidamente a situação sem se expor ao perigo.

## Fuite d’eau (10)

- landing · `setup.needs.options.water.label`
  - FR : Une fuite d’eau
  - PT : Uma fuga de água
- mobile · `dashboardApp.alertExplanation.waterLeak`
  - FR : Le capteur a signalé la présence d’eau. Vérifiez la zone concernée et coupez l’eau si nécessaire.
  - PT : O sensor assinalou a presença de água. Verifique a zona em causa e corte a água, se necessário.
- mobile · `dashboardApp.alertTitle.waterLeakDetected`
  - FR : Fuite d’eau détectée
  - PT : Fuga de água detetada
- mobile · `dashboardApp.waterLeakDetection`
  - FR : Détection des fuites d’eau
  - PT : Deteção de fugas de água
- mobile · `mobileSettingsPanel.whenAWaterLeakIs`
  - FR : Lorsqu’une fuite d’eau est détectée.
  - PT : Quando é detetada uma fuga de água.
- mobile · `mockApi.waterLeakDetector`
  - FR : Détecteur de fuite d’eau
  - PT : Detetor de fuga de água
- mobile · `sensorCategories.water_leak.description`
  - FR : Les points d’eau à surveiller
  - PT : Os pontos de água a vigiar
- web · `alertsPage.displayTitle.safetyTitles.WATER_LEAK`
  - FR : Fuite d’eau détectée
  - PT : Fuga de água detetada
- web · `alertsPage.explanationFor.safetyExplanations.WATER_LEAK`
  - FR : Le capteur a signalé la présence d’eau. Vérifiez la zone concernée et coupez l’eau si nécessaire.
  - PT : O sensor assinalou a presença de água. Verifique a zona em causa e corte a água, se necessário.
- web · `alertsPage.safetyCard.water`
  - FR : Détection des fuites d’eau
  - PT : Deteção de fugas de água

## Monoxyde de carbone (CO) (8)

- mobile · `dashboardApp.alertExplanation.carbonMonoxide`
  - FR : Le détecteur a signalé du monoxyde de carbone. Vérifiez immédiatement la situation et suivez les consignes d’urgence.
  - PT : O detetor assinalou monóxido de carbono. Verifique imediatamente a situação e siga as instruções de emergência.
- mobile · `dashboardApp.alertTitle.carbonMonoxideDetected`
  - FR : Monoxyde de carbone détecté
  - PT : Monóxido de carbono detetado
- mobile · `sensorCategories.air_quality.description`
  - FR : CO₂, particules et qualité de l’air
  - PT : CO₂, partículas e qualidade do ar
- mobile · `sensorCategories.carbon_monoxide.description`
  - FR : Les signaux du détecteur de CO
  - PT : Os sinais do detetor de CO
- web · `activityPage.capabilityLabels.carbon_monoxide`
  - FR : Monoxyde de carbone
  - PT : Monóxido de carbono
- web · `alertsPage.displayTitle.safetyTitles.CARBON_MONOXIDE`
  - FR : Monoxyde de carbone détecté
  - PT : Monóxido de carbono detetado
- web · `alertsPage.explanationFor.safetyExplanations.CARBON_MONOXIDE`
  - FR : Le détecteur a signalé du monoxyde de carbone. Vérifiez immédiatement la situation et suivez les consignes d’urgence.
  - PT : O detetor assinalou monóxido de carbono. Verifique imediatamente a situação e siga as instruções de emergência.
- web · `welcomePage.sensorLabels.carbon_monoxide`
  - FR : Monoxyde de carbone
  - PT : Monóxido de carbono

## Bouton d’assistance / SOS / urgences (14)

- landing · `app.caution`
  - FR : Élise n’est ni un dispositif médical, ni une téléassistance, ni un service d’urgence. En cas d’urgence, appelez le 112 ou le 15.
  - PT : A Élise não é um dispositivo médico, nem uma teleassistência, nem um serviço de emergência. Em caso de emergência, ligue para o 112.
- landing · `landing.footer.disclaimer`
  - FR : Élise n’est ni un dispositif médical ni un service d’urgence.
  - PT : A Élise não é um dispositivo médico nem um serviço de emergência.
- landing · `landing.install.lead`
  - FR : Élise est en phase de test. Elle est faite pour être essayée en famille, idéalement avec un proche à l’aise avec l’informatique. Elle ne remplace pas une téléassistance.
  - PT : A Élise está em fase de testes. Foi pensada para ser experimentada em família, idealmente com alguém à vontade com a informática. Não substitui uma teleassistência.
- landing · `landing.principles.items.5.text`
  - FR : Élise aide à savoir quand prendre des nouvelles. Elle ne remplace ni la téléassistance, ni les secours, ni une visite.
  - PT : A Élise ajuda a saber quando é boa altura para pedir notícias. Não substitui a teleassistência, nem os serviços de emergência, nem uma visita.
- landing · `setup.needs.options.call.text`
  - FR : Un simple bouton. Ce n’est pas une téléassistance.
  - PT : Um simples botão. Não é uma teleassistência.
- mobile · `dashboardApp.alertExplanation.assistanceButton`
  - FR : Le bouton d’assistance du domicile a été activé. Contactez rapidement la personne.
  - PT : O botão de assistência da casa foi ativado. Contacte rapidamente a pessoa.
- mobile · `dashboardApp.urgentStatusUnavailable`
  - FR : État des urgences indisponible
  - PT : Estado das urgências indisponível
- mobile · `mobilePeoplePanel.emergencyContact`
  - FR : Contact d’urgence
  - PT : Contacto de emergência
- mobile · `mobileSettingsPanel.eliseIsNeitherAMedical`
  - FR : Élise n’est ni un dispositif médical ni un service d’urgence.
  - PT : A Élise não é um dispositivo médico nem um serviço de emergência.
- mobile · `mobileSettingsPanel.inAnEmergencyCall112`
  - FR : En cas d’urgence, appelez le 112
  - PT : Em caso de emergência, ligue 112
- mobile · `sensorProducts.heiman-fall-detection.placement.2`
  - FR : Élise complète la vigilance des proches : cette détection ne remplace pas une téléassistance ni une vérification humaine.
  - PT : Élise complementa a atenção dos familiares: esta deteção não substitui um serviço de teleassistência nem uma verificação humana.
- mobile · `welcomeExperience.copy.privacy.disclaimer`
  - FR : Élise n’est ni un dispositif médical ni un service d’urgence. En cas d’urgence, appelez le 112.
  - PT : Élise não é um dispositivo médico nem um serviço de emergência. Em caso de emergência, ligue 112.
- web · `alertsPage.urgencyStatusUnavailable`
  - FR : État des urgences indisponible
  - PT : Estado das urgências indisponível
- web · `app.emergencyContact`
  - FR : Contact d’urgence
  - PT : Contacto de emergência

## Alertes urgentes / prise en charge (12)

- landing · `app.meta.description`
  - FR : L’application mobile Élise pour les proches et les aidants : la journée en un coup d’œil, une alerte seulement quand il le faut, le carnet de liaison et la télévision du proche depuis votre téléphone.
  - PT : A aplicação móvel Élise para familiares e cuidadores: o dia num relance, um alerta só quando é preciso, o caderno de ligação e a televisão do seu familiar a partir do telemóvel.
- landing · `app.tablet.lead`
  - FR : Sur une tablette, tout tient sur un écran : la journée, les alertes, le logement, le carnet et la télévision.
  - PT : Num tablet, cabe tudo num só ecrã: o dia, os alertas, a casa, o caderno e a televisão.
- landing · `pilot.pilot.stages.items.2.desc`
  - FR : Rejouer des situations définies, recueillir les retours et analyser les alertes utiles, manquées ou jugées inutiles.
  - PT : Reproduzir situações definidas, recolher opiniões e analisar os alertas úteis, falhados ou considerados desnecessários.
- landing · `privacy.sections.4.items.4`
  - FR : Captures liées aux alertes : 24 heures, stockées localement et exclues des sauvegardes habituelles.
  - PT : Capturas associadas aos alertas: 24 horas, guardadas localmente e excluídas das cópias de segurança habituais.
- landing · `setup.steps.app.body`
  - FR : Sur iPhone, iPad ou Android, ils suivent la maison et reçoivent les alertes. Sur le Wi-Fi de la maison, l’application trouve Élise toute seule ; à distance, ils scannent le QR code affiché dans Élise.
  - PT : No iPhone, iPad ou Android, os familiares acompanham a casa e recebem os alertas. Na rede Wi-Fi de casa, a aplicação encontra a Élise sozinha; à distância, basta ler o código QR apresentado na Élise.
- mobile · `app.alertsCannotBeRefreshed`
  - FR : Les alertes ne peuvent pas être actualisées.
  - PT : Não é possível atualizar os alertas.
- mobile · `app.reviewTheOpenAlertsBelow`
  - FR : Consultez les alertes ouvertes ci-dessous.
  - PT : Consulte os alertas abertos abaixo.
- mobile · `dashboardApp.noAlertsInTheHistory`
  - FR : Aucune alerte dans l’historique.
  - PT : Nenhum alerta no histórico.
- mobile · `dashboardApp.noRecentOrOngoingAlerts`
  - FR : Aucune alerte récente ou en cours. Des situations terminées plus anciennes sont dans l’historique.
  - PT : Nenhum alerta recente ou em curso. As situações terminadas mais antigas estão no histórico.
- mobile · `mobileSettingsPanel.onlyAnAdministratorCanChange`
  - FR : Seul un administrateur peut modifier les règles des alertes.
  - PT : Só um administrador pode alterar as regras dos alertas.
- mobile · `welcomeExperience.copy.mobile.body`
  - FR : Consultez les faits du jour, les événements et les alertes. Une situation inhabituelle invite à vérifier et à prendre des nouvelles, jamais à conclure à distance.
  - PT : Consulte os factos do dia, os eventos e os alertas. Uma situação invulgar é um convite a verificar e a pedir notícias, nunca a tirar conclusões à distância.
- web · `sensorProducts.heiman-fall-detection.preparation.3`
  - FR : Après l’installation, vérifiez la réception d’une alerte de chute avec le mode de test indiqué par le fabricant. Le modèle n’a pas encore été testé physiquement avec Élise.
  - PT : Após a instalação, verifique a receção de um alerta de queda com o modo de teste indicado pelo fabricante. O modelo ainda não foi testado fisicamente com a Élise.

## Confidentialité / vie privée (16)

- landing · `app.connect.steps.1.text`
  - FR : Scannez une fois le code affiché dans les réglages d’Élise. Ensuite, l’application se connecte aussi de chez vous, par un accès privé et chiffré.
  - PT : Leia uma vez o código mostrado nas definições da Élise. A partir daí, a aplicação também se liga a partir da sua casa, através de um acesso privado e cifrado.
- landing · `app.features.4.extra.alt`
  - FR : Détail du séjour : capteurs de température, humidité, mouvement, caméra et fumée, tous configurés.
  - PT : Pormenor da sala: sensores de temperatura, humidade, movimento, câmara e fumo, todos configurados.
- landing · `landing.meta.description`
  - FR : Élise est un petit boîtier qui veille discrètement sur un proche qui vit seul. Des capteurs repèrent les gestes du quotidien et la famille est prévenue seulement si quelque chose sort de l’habitude. Sans caméra, gratuit et libre.
  - PT : A Élise é uma pequena box que zela discretamente por um familiar que vive sozinho. Os sensores registam os gestos do dia a dia e a família só é avisada se algo fugir ao habitual. Sem câmara, gratuita e livre.
- landing · `landing.principles.items.0.text`
  - FR : Élise fonctionne avec de simples capteurs. Si vous ajoutez une caméra, ses images ne servent jamais à analyser la journée.
  - PT : A Élise funciona com simples sensores. Se acrescentar uma câmara, as suas imagens nunca são usadas para analisar o dia.
- landing · `pilot.pilot.framework.items.1.desc`
  - FR : Traitement local ; accès distant privé ; notifications externes au contenu minimal. Les durées de conservation et les accès du pilote seront précisés dans son protocole.
  - PT : Tratamento local; acesso remoto privado; notificações externas com conteúdo mínimo. Os prazos de conservação e os acessos do piloto serão especificados no respetivo protocolo.
- landing · `privacy.sections.2.paragraphs.3`
  - FR : Élise OS ne peut pas vérifier qu’une caméra tierce a cessé d’enregistrer lorsqu’un mode de confidentialité logiciel est utilisé seul. Un dispositif matériel de confidentialité est préférable.
  - PT : O Élise OS não consegue verificar se uma câmara de terceiros deixou de gravar quando é utilizado apenas um modo de privacidade por software. É preferível um dispositivo físico de privacidade.
- landing · `setup.steps.phoneRemote.body`
  - FR : Tailscale relie vos téléphones au boîtier par un tunnel privé et chiffré, sans rien ouvrir sur internet. C’est gratuit pour une famille.
  - PT : O Tailscale liga os seus telemóveis à box através de um túnel privado e cifrado, sem abrir nada na internet. É gratuito para uma família.
- mobile · `dashboardApp.alertExplanation.sensorOffline`
  - FR : Élise ne reçoit plus de données de ce capteur. Vérifiez son alimentation et sa connexion ; les conclusions qui en dépendent sont suspendues.
  - PT : A Élise deixou de receber dados deste sensor. Verifique a alimentação e a ligação; as conclusões que dele dependem estão suspensas.
- mobile · `mobileSetup.copy.intros.4`
  - FR : Tailscale relie votre téléphone à Élise par un tunnel privé et chiffré, sans rien ouvrir sur Internet.
  - PT : O Tailscale liga o seu telemóvel à Élise através de um túnel privado e encriptado, sem abrir nada na Internet.
- web · `alertsPage.advice.SENSOR_OFFLINE`
  - FR : Élise ne reçoit plus de données de ce capteur. Vérifiez son alimentation et sa connexion ; certaines conclusions restent suspendues.
  - PT : A Élise deixou de receber dados deste sensor. Verifique a alimentação e a ligação; algumas conclusões ficam suspensas.
- web · `alertsPage.explanationFor.safetyExplanations.SENSOR_OFFLINE`
  - FR : Élise ne reçoit plus de données de ce capteur. Vérifiez son alimentation et sa connexion ; les conclusions qui en dépendent sont suspendues.
  - PT : A Élise deixou de receber dados deste sensor. Verifique a alimentação e a ligação; as conclusões que dele dependem estão suspensas.
- web · `alertsPage.noReliableMovementTimeIs`
  - FR : Aucun horaire de mouvement fiable n’est disponible avant le déclenchement. Vérifiez les capteurs : une absence de données ne confirme pas une absence de mouvement.
  - PT : Não há nenhum horário de movimento fiável disponível antes do desencadeamento. Verifique os sensores: a ausência de dados não confirma a ausência de movimento.
- web · `cameraNetworkOnboarding.checkThatTheCameraIs`
  - FR : Vérifiez que la caméra est allumée, sur le réseau du logement et que son flux RTSP est activé, puis relancez la recherche.
  - PT : Verifique se a câmara está ligada, na rede da casa e com o fluxo RTSP ativado e, depois, procure novamente.
- web · `cameraNetworkOnboarding.theLocalStreamRequiresA`
  - FR : Le flux local demande un mot de passe. Le nom courant « admin » est prérempli. Saisissez le mot de passe de la caméra, pas celui de votre compte Imou Life.
  - PT : O fluxo local pede uma palavra-passe. O nome habitual «admin» já está preenchido. Introduza a palavra-passe da câmara, não a da sua conta Imou Life.
- web · `setup.accessDeniedOpenEliseFrom`
  - FR : Accès refusé. Ouvrez Élise depuis le réseau local ou son accès privé Tailscale.
  - PT : Acesso recusado. Abra a Élise a partir da rede local ou do acesso privado Tailscale.
- web · `setup.yourDataStaysLocallyOn`
  - FR : Vos données restent stockées localement sur votre installation Élise OS.
  - PT : Os seus dados ficam guardados localmente na sua instalação do Élise OS.

## Accès à distance (14)

- landing · `landing.principles.items.2.text`
  - FR : Pour consulter Élise à distance, il faut avoir été invité par la famille. Rien n’est publié sur Internet.
  - PT : Para consultar a Élise à distância, é preciso ter sido convidado pela família. Nada é publicado na Internet.
- landing · `pilot.pilot.intent.desc`
  - FR : L’objectif est d’évaluer si l’ensemble Élise peut soutenir le maintien à domicile : donner des repères aux proches, simplifier la télévision du résident et permettre d’agir à distance sans empiéter sur son intimité.
  - PT : O objetivo é avaliar se o conjunto Élise pode apoiar a permanência em casa: dar indicadores aos familiares, simplificar a televisão do residente e permitir agir à distância sem invadir a sua intimidade.
- landing · `setup.steps.phoneFamily.body`
  - FR : Créez le compte de chaque proche dans Élise. Ils installent l’application : sur le Wi-Fi de la maison, elle trouve Élise toute seule ; à distance, ils scannent le QR code affiché dans les réglages d’Élise, avec Tailscale actif.
  - PT : Crie na Élise a conta de cada familiar. Eles instalam a aplicação: no Wi-Fi da casa, ela encontra a Élise sozinha; à distância, leem o código QR mostrado nas definições da Élise, com o Tailscale ativo.
- landing · `ui.download.completeScriptForAnAmd64`
  - FR : Script complet pour un serveur AMD64 ou ARM64 : Docker, Tailscale, Avahi, Élise et l’écran TV.
  - PT : Script completo para um servidor AMD64 ou ARM64: Docker, Tailscale, Avahi, Élise e o ecrã da TV.
- mobile · `app.addressNotFoundCheckThe`
  - FR : Adresse introuvable. Vérifiez le réseau local ou que Tailscale est actif.
  - PT : Endereço não encontrado. Verifique a rede local ou se o Tailscale está ativo.
- mobile · `app.theEliseLinkIsValid`
  - FR : Le lien Élise est valide, mais Tailscale ne répond pas encore.
  - PT : A ligação Élise é válida, mas o Tailscale ainda não responde.
- mobile · `app.useYourServerSLocal`
  - FR : Utilisez l’adresse locale ou Tailscale de votre serveur.
  - PT : Utilize o endereço local ou Tailscale do seu servidor.
- mobile · `app.yourPhoneLooksForElise`
  - FR : Votre téléphone cherche Élise sur le Wi-Fi du domicile ou via une adresse Tailscale enregistrée.
  - PT : O seu telemóvel procura a Élise no Wi-Fi de casa ou através de um endereço Tailscale guardado.
- mobile · `mobileSettingsPanel.noResponseCheckTailscaleAnd`
  - FR : Aucune réponse. Vérifiez Tailscale et réessayez.
  - PT : Sem resposta. Verifique o Tailscale e tente novamente.
- mobile · `mobileSettingsPanel.useEliseAwayFromHome`
  - FR : Consultez Élise depuis l’extérieur avec Tailscale. Seules les personnes invitées peuvent entrer.
  - PT : Consulte a Élise fora de casa com o Tailscale. Só as pessoas convidadas podem entrar.
- mobile · `remoteAccessStep.copy.degraded`
  - FR : L’accès à distance demande une vérification. Vous pourrez reprendre dans les réglages.
  - PT : O acesso remoto precisa de ser verificado. Pode retomar mais tarde nas definições.
- web · `remoteAccessCard.useEliseAwayFromHome`
  - FR : Consultez Élise depuis l’extérieur avec Tailscale. Seules les personnes invitées peuvent entrer.
  - PT : Consulte a Élise fora de casa com o Tailscale. Só as pessoas convidadas podem entrar.
- web · `remoteAccessCard.yourTailscaleKeyIsNever`
  - FR : Votre clé Tailscale n’est jamais stockée dans l’image Élise.
  - PT : A sua chave Tailscale nunca é guardada na imagem Élise.
- web · `setup.cannotReachEliseCheckYour`
  - FR : Impossible de joindre Élise. Vérifiez votre connexion locale ou Tailscale.
  - PT : Não é possível contactar a Élise. Verifique a sua ligação local ou Tailscale.
