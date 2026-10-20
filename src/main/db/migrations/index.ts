import type Database from 'better-sqlite3'

export type Migration = Readonly<{ version: number; up: (db: Database.Database) => void }>

export const migrations: readonly Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE users (
          id TEXT PRIMARY KEY, login_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('ADMIN','STAFF')),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
          must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
          failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
          locked_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT
        );
        CREATE TABLE password_reset_codes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          code_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
          failed_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
          consumed_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL,
          issuer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          issuer_kind TEXT NOT NULL CHECK (issuer_kind IN ('ADMIN','OFFLINE_RECOVERY'))
        );
        CREATE TABLE audit_logs (
          id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          actor_login_snapshot TEXT, actor_name_snapshot TEXT, actor_role_snapshot TEXT,
          action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `)
    }
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE UNIQUE INDEX password_reset_one_live_per_user
          ON password_reset_codes(user_id)
          WHERE consumed_at IS NULL AND revoked_at IS NULL;
        CREATE INDEX password_reset_expiry ON password_reset_codes(expires_at);
        CREATE INDEX audit_created_at ON audit_logs(created_at DESC);
        CREATE INDEX audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
      `)
    }
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          name_key TEXT NOT NULL UNIQUE,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE products (
          id TEXT PRIMARY KEY,
          sku TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(sku) BETWEEN 1 AND 64),
          name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
          name_search_key TEXT NOT NULL,
          category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
          unit TEXT NOT NULL CHECK (length(unit) BETWEEN 1 AND 16),
          current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock BETWEEN 0 AND 2147483647),
          reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level BETWEEN 0 AND 2147483647),
          note TEXT CHECK (note IS NULL OR length(note) <= 2000),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX products_name ON products(name_search_key COLLATE NOCASE, sku COLLATE NOCASE, id);
        CREATE INDEX products_category ON products(category_id);
        CREATE INDEX products_active ON products(is_active);
      `)
    }
  },
  {
    version: 4,
    up(db) {
      db.exec(`
        CREATE TABLE stock_movements (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          movement_type TEXT NOT NULL CHECK (movement_type IN ('OPENING','RECEIPT','ISSUE','ADJUSTMENT')),
          quantity_delta INTEGER NOT NULL CHECK (typeof(quantity_delta)='integer'),
          stock_before INTEGER NOT NULL CHECK (typeof(stock_before)='integer' AND stock_before BETWEEN 0 AND 2147483647),
          stock_after INTEGER NOT NULL CHECK (typeof(stock_after)='integer' AND stock_after BETWEEN 0 AND 2147483647),
          reason_code TEXT NOT NULL CHECK (reason_code IN ('DELIVERY','RETURN','DAMAGE','EXPIRED','STOCKTAKE','OTHER')),
          note TEXT CHECK (note IS NULL OR length(note) <= 2000),
          actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          actor_login_snapshot TEXT NOT NULL,
          actor_name_snapshot TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (stock_after = stock_before + quantity_delta),
          CHECK ((movement_type='RECEIPT' AND quantity_delta>0) OR
                 (movement_type='ISSUE' AND quantity_delta<0) OR
                 (movement_type='ADJUSTMENT') OR (movement_type='OPENING' AND stock_before=0 AND quantity_delta>=0))
        );
        CREATE INDEX stock_movements_product_created ON stock_movements(product_id, created_at DESC, id DESC);
        CREATE INDEX stock_movements_created ON stock_movements(created_at DESC, id DESC);
        CREATE INDEX stock_movements_actor_created ON stock_movements(actor_user_id, created_at DESC, id DESC);
      `)
    }
  },
  {
    version: 5,
    up(db) {
      db.exec(`ALTER TABLE audit_logs ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'USER' CHECK (actor_kind IN ('USER','OFFLINE_RECOVERY','SYSTEM'))`)
    }
  },
  {
    version: 6,
    up(db) {
      const duplicate = db.prepare("SELECT product_id FROM stock_movements WHERE movement_type='OPENING' GROUP BY product_id HAVING COUNT(*)>1 LIMIT 1").get()
      if (duplicate) throw new Error('OPENING_MOVEMENT_DUPLICATES_EXIST')
      db.exec("CREATE UNIQUE INDEX stock_movements_one_opening_per_product ON stock_movements(product_id) WHERE movement_type='OPENING'")
    }
  }
]
