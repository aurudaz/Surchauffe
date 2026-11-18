# SIA Thermic Studio — Simulateur de surchauffe & confort thermique

Application web modulaire de simulation thermique dynamique horaire pour l'évaluation de la surchauffe estivale (**SIA 180**, **SIA 380/1**, **ISO 13790 5R1C**) et du **confort thermique multi-normes**.

## Architecture des fichiers & Méthodologie de calcul

L'architecture sépare strictement les données normatives (`src/standards/`), la chaîne de calcul étape par étape (`src/methodology/`), l'état/import (`src/state/`, `src/parsers/`) et l'interface utilisateur (`src/ui/`).

```text
Surchauffe/
├── index.html                           # Point d'entrée HTML
├── package.json                         # Commandes `npm run dev` et `npm test`
├── css/
│   ├── tokens.css                       # Variables de thèmes (Sombre / Clair)
│   ├── layout.css                       # Mise en page, responsive, impression PDF
│   └── components.css                   # Composants UI, cartes confort & méthodologie
├── src/
│   ├── app.js                           # Orchestrateur principal
│   ├── standards/                       # Constantes & tables normatives
│   │   ├── sia380-1.js                  # Catégories I–XII SIA 380/1:2016, enveloppes, stores
│   │   ├── sia180.js                    # Courbes Fig. 3/4, Méthode 1 (Tab. 8), Méthode 2 (Fig. 12)
│   │   ├── swiss-stations.js            # Stations suisses & projections REF / 2050 / 2100
│   │   └── comfort-references.js        # Seuils EN 16798-1, ASHRAE 55, ISO 7730, CIBSE TM52/59, OMS, Seppänen
│   ├── methodology/                     # Pipeline de calcul numéroté (ordre d'exécution)
│   │   ├── 01-solar-geometry.js         # Position solaire, irradiance incidente, casquette horizontale
│   │   ├── 02-weather-model.js          # Climat synthétique suisse, parseurs PVGIS JSON/CSV & EPW
│   │   ├── 03-envelope-and-gains.js     # Réseau 5R1C (A_tot, A_m, H_tr, C_m), gains internes & solaires
│   │   ├── 04-natural-ventilation.js    # Ventilation diurne, infiltration, ouvrants nocturnes EN 16798-7
│   │   ├── 05-thermal-5r1c-engine.js    # Solveur Crank-Nicolson 5R1C (4 sous-pas/h) + froid fictif
│   │   ├── 06-sia180-compliance.js      # Vérifications SIA 180 Méthodes 1, 2, 3 & score de résilience
│   │   ├── 07-thermal-comfort.js        # Confort thermique multi-normes & études scientifiques
│   │   └── 08-scenario-comparator.js    # Comparateur 4 scénarios (Actuel / Optimal / Oubli / 2050)
│   ├── parsers/
│   │   └── house-importers.js           # Import .json, .gbxml/.xml, .ifc, .idf
│   ├── state/
│   │   ├── house-library.js             # Bâtiments types SIA pré-configurés
│   │   └── project-store.js             # État applicatif & utilitaires
│   └── ui/
│       ├── charts.js                    # Graphiques Canvas (horaire, SIA 180, bilan, orientations, confort)
│       ├── config-view.js               # Écrans de configuration (Simple / Avancé)
│       ├── results-view.js              # Écran résultats & section Confort Thermique interactive
│       └── methodology-view.js          # Onglet « Méthodologie & Traçabilité » avec valeurs intermédiaires
├── scripts/
│   └── dev-server.mjs                   # Serveur local statique (Node.js sans dépendance)
└── tests/
    └── physics.test.mjs                 # Suite de tests unitaires (node --test)
```

## Lancer localement & exécuter les tests

Prérequis : Node.js 20+ (zéro `npm install` nécessaire).

```bash
# 1. Lancer la suite de tests physiques et normatifs
npm test

# 2. Démarrer un serveur web local (preview)
npm run dev
# Ouvrir ensuite http://127.0.0.1:4173
```

## Mettre sur GitHub, prévisualiser et héberger gratuitement (GitHub Pages)

1. Créer un dépôt vide sur GitHub (ex. `sia-thermic-studio`).
2. Initialiser et pousser le dossier :
   ```bash
   git init
   git add .
   git commit -m "Initial commit: SIA Thermic Studio modulaire"
   git branch -M main
   git remote add origin https://github.com/<VOTRE_COMPTE>/<VOTRE_REPO>.git
   git push -u origin main
   ```
3. Activer l'hébergement direct : dans GitHub → **Settings** → **Pages** → **Source : GitHub Actions** (le workflow `.github/workflows/deploy-pages.yml` inclus lance automatiquement `npm test` puis publie le site sur `https://<VOTRE_COMPTE>.github.io/<VOTRE_REPO>/`).
4. Pour prévisualiser chaque branche ou Pull Request automatiquement avant fusion, vous pouvez également connecter le dépôt GitHub à **Cloudflare Pages**, **Netlify** ou **Vercel** (aucune commande de build requise, dossier racine `.`).
