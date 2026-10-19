// Arquivamento independente: não modifica os dados já coletados do equipamento.
export function ensureAssetArchive(db){db.exec('CREATE TABLE IF NOT EXISTS asset_archive(asset_id INTEGER PRIMARY KEY,deleted_at TEXT NOT NULL,deleted_by INTEGER)');}
export function assetArchive(db,id){return db.prepare('SELECT deleted_at,deleted_by FROM asset_archive WHERE asset_id=?').get(id);}
