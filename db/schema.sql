CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(80)  NOT NULL,
  correo        VARCHAR(120) NOT NULL,
  telefono      VARCHAR(20),
  password_hash TEXT         NOT NULL,
  rol           TEXT         NOT NULL DEFAULT 'cliente' CHECK (rol IN ('cliente','cocina','almacen','admin')),
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_uq ON usuarios (lower(correo));

CREATE TABLE IF NOT EXISTS insumos (
  id             SERIAL PRIMARY KEY,
  nombre         VARCHAR(80) NOT NULL UNIQUE,
  unidad         VARCHAR(10) NOT NULL,
  stock          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_minimo   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  costo_unitario NUMERIC(10,4) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  activo         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS productos (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(80) NOT NULL UNIQUE,
  descripcion VARCHAR(300),
  precio      NUMERIC(10,2) NOT NULL CHECK (precio > 0),
  activo      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS presentaciones (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(60) NOT NULL UNIQUE,
  precio    NUMERIC(10,2) NOT NULL CHECK (precio >= 0),
  insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  activo    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS recetas (
  id          SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL UNIQUE REFERENCES productos(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS receta_ingredientes (
  receta_id INTEGER NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  cantidad  NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (receta_id, insumo_id)
);

CREATE TABLE IF NOT EXISTS pedidos (
  id              SERIAL PRIMARY KEY,
  cliente_id      INTEGER NOT NULL REFERENCES usuarios(id),
  presentacion_id INTEGER NOT NULL REFERENCES presentaciones(id),
  fecha_entrega   DATE NOT NULL,
  hora_entrega    TIME NOT NULL,
  dedicatoria     VARCHAR(120),
  total           NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  estatus         TEXT NOT NULL DEFAULT 'Pendiente'
                  CHECK (estatus IN ('Pendiente','En preparación','Listo para entrega','Entregado')),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pedidos_entrega_idx ON pedidos (fecha_entrega, hora_entrega);
CREATE INDEX IF NOT EXISTS pedidos_estatus_idx ON pedidos (estatus);

CREATE TABLE IF NOT EXISTS pedido_items (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id     INTEGER NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(10,2) NOT NULL CHECK (precio_unitario > 0)
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id         SERIAL PRIMARY KEY,
  insumo_id  INTEGER NOT NULL REFERENCES insumos(id),
  tipo       TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste')),
  cantidad   NUMERIC(12,2) NOT NULL,
  pedido_id  INTEGER REFERENCES pedidos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pagos (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id),
  proveedor  VARCHAR(30) NOT NULL,
  referencia VARCHAR(120),
  monto      NUMERIC(10,2) NOT NULL CHECK (monto > 0),
  estado     TEXT NOT NULL CHECK (estado IN ('aprobado','rechazado','pendiente')),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkouts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id INTEGER NOT NULL REFERENCES usuarios(id),
  payload    JSONB NOT NULL,
  total      NUMERIC(10,2) NOT NULL CHECK (total > 0),
  estado     TEXT NOT NULL DEFAULT 'creado' CHECK (estado IN ('creado','pagado','rechazado','expirado','revision')),
  proveedor  VARCHAR(30) NOT NULL,
  referencia VARCHAR(120),
  pedido_id  INTEGER REFERENCES pedidos(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS checkouts_cliente_idx ON checkouts (cliente_id);

CREATE UNIQUE INDEX IF NOT EXISTS pagos_ref_uq ON pagos (proveedor, referencia);

ALTER TABLE recetas ADD COLUMN IF NOT EXISTS rinde INTEGER NOT NULL DEFAULT 1 CHECK (rinde > 0 AND rinde <= 1000);

ALTER TABLE insumos ALTER COLUMN stock TYPE NUMERIC(14,4);
ALTER TABLE insumos ALTER COLUMN stock_minimo TYPE NUMERIC(14,4);
ALTER TABLE movimientos_inventario ALTER COLUMN cantidad TYPE NUMERIC(14,4);
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS nota VARCHAR(200);
CREATE INDEX IF NOT EXISTS movimientos_insumo_idx ON movimientos_inventario (insumo_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS pedido_estatus_historial (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  estatus    TEXT NOT NULL CHECK (estatus IN ('Pendiente','En preparación','Listo para entrega','Entregado')),
  usuario_id INTEGER REFERENCES usuarios(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, estatus)
);
INSERT INTO pedido_estatus_historial (pedido_id, estatus, creado_en)
  SELECT p.id, 'Pendiente', p.creado_en FROM pedidos p
  WHERE NOT EXISTS (SELECT 1 FROM pedido_estatus_historial h WHERE h.pedido_id = p.id AND h.estatus = 'Pendiente');

CREATE TABLE IF NOT EXISTS notificaciones (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  cliente_id      INTEGER NOT NULL REFERENCES usuarios(id),
  canal           TEXT NOT NULL DEFAULT 'correo',
  plantilla       TEXT NOT NULL,
  destinatario    VARCHAR(120) NOT NULL,
  asunto          VARCHAR(200) NOT NULL,
  cuerpo_texto    TEXT NOT NULL,
  cuerpo_html     TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviando','enviada','error','fallida')),
  intentos        INTEGER NOT NULL DEFAULT 0,
  ultimo_error    TEXT,
  proximo_intento TIMESTAMPTZ,
  reclamado_en    TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviada_en      TIMESTAMPTZ,
  UNIQUE (pedido_id, plantilla)
);
CREATE INDEX IF NOT EXISTS notificaciones_estado_idx ON notificaciones (estado, proximo_intento);

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS proveedores (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(80) NOT NULL,
  correo    VARCHAR(120) NOT NULL,
  contacto  VARCHAR(80),
  telefono  VARCHAR(30),
  notas     VARCHAR(300),
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proveedores_nombre_uq ON proveedores (lower(nombre));

CREATE TABLE IF NOT EXISTS proveedor_insumos (
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  insumo_id    INTEGER NOT NULL REFERENCES insumos(id),
  PRIMARY KEY (proveedor_id, insumo_id)
);

CREATE TABLE IF NOT EXISTS pedidos_proveedor (
  id             SERIAL PRIMARY KEY,
  proveedor_id   INTEGER NOT NULL REFERENCES proveedores(id),
  usuario_id     INTEGER REFERENCES usuarios(id),
  estado         TEXT NOT NULL DEFAULT 'enviado' CHECK (estado IN ('enviado','recibido','cancelado')),
  suma_stock_en  TEXT NOT NULL DEFAULT 'recepcion' CHECK (suma_stock_en IN ('recepcion','envio')),
  stock_aplicado BOOLEAN NOT NULL DEFAULT false,
  nota           VARCHAR(300),
  fecha_requerida DATE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  recibido_en    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pedidos_proveedor_estado_idx ON pedidos_proveedor (estado, creado_en DESC);

CREATE TABLE IF NOT EXISTS pedido_proveedor_items (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos_proveedor(id) ON DELETE CASCADE,
  insumo_id  INTEGER NOT NULL REFERENCES insumos(id),
  cantidad   NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
  UNIQUE (pedido_id, insumo_id)
);

ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS pedido_proveedor_id INTEGER REFERENCES pedidos_proveedor(id);

ALTER TABLE notificaciones ALTER COLUMN pedido_id DROP NOT NULL;
ALTER TABLE notificaciones ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS pedido_proveedor_id INTEGER REFERENCES pedidos_proveedor(id) ON DELETE CASCADE;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS responder_a VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS notificaciones_pp_uq ON notificaciones (pedido_proveedor_id, plantilla) WHERE pedido_proveedor_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_destino_ck
    CHECK ((pedido_id IS NOT NULL AND pedido_proveedor_id IS NULL) OR (pedido_id IS NULL AND pedido_proveedor_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_cp          VARCHAR(5);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_colonia     VARCHAR(80);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_calle       VARCHAR(100);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_num_ext     VARCHAR(20);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_num_int     VARCHAR(20);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_municipio   VARCHAR(80);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_estado      VARCHAR(40);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_referencias VARCHAR(200);

ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS leida_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS notificaciones_cliente_idx ON notificaciones (cliente_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS decisiones (
  id          SERIAL PRIMARY KEY,
  caso_id     VARCHAR(40) NOT NULL,
  titulo      VARCHAR(120) NOT NULL,
  alternativa VARCHAR(80) NOT NULL,
  base        VARCHAR(40) NOT NULL,
  notas       VARCHAR(500),
  matriz      JSONB NOT NULL,
  resultados  JSONB NOT NULL,
  usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decisiones_creado_idx ON decisiones (creado_en DESC);

CREATE TABLE IF NOT EXISTS decision_datos (
  caso_id        VARCHAR(40) PRIMARY KEY,
  pagos          JSONB NOT NULL,
  probabilidades JSONB NOT NULL,
  alfa           NUMERIC(4,3) NOT NULL DEFAULT 0.6,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS dw;
CREATE TABLE IF NOT EXISTS dw.dim_fecha (
  fecha_key    INTEGER PRIMARY KEY,
  fecha        DATE NOT NULL UNIQUE,
  anio         SMALLINT NOT NULL,
  trimestre    SMALLINT NOT NULL,
  mes          SMALLINT NOT NULL,
  nombre_mes   VARCHAR(12) NOT NULL,
  dia          SMALLINT NOT NULL,
  dia_semana   SMALLINT NOT NULL,
  nombre_dia   VARCHAR(12) NOT NULL,
  es_fin_semana BOOLEAN NOT NULL,
  temporada    VARCHAR(30) NOT NULL
);
CREATE TABLE IF NOT EXISTS dw.dim_producto (
  producto_key   SERIAL PRIMARY KEY,
  producto_id    INTEGER NOT NULL UNIQUE,
  nombre         VARCHAR(80) NOT NULL,
  precio_lista   NUMERIC(10,2) NOT NULL,
  costo_estimado NUMERIC(10,4) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS dw.dim_presentacion (
  presentacion_key SERIAL PRIMARY KEY,
  presentacion_id  INTEGER NOT NULL UNIQUE,
  nombre           VARCHAR(60) NOT NULL
);
CREATE TABLE IF NOT EXISTS dw.dim_zona (
  zona_key  SERIAL PRIMARY KEY,
  cp        VARCHAR(5) NOT NULL,
  colonia   VARCHAR(80) NOT NULL,
  municipio VARCHAR(80) NOT NULL,
  UNIQUE (cp, colonia, municipio)
);
CREATE TABLE IF NOT EXISTS dw.fact_ventas (
  id               BIGSERIAL PRIMARY KEY,
  fecha_key        INTEGER NOT NULL REFERENCES dw.dim_fecha(fecha_key),
  producto_key     INTEGER NOT NULL REFERENCES dw.dim_producto(producto_key),
  presentacion_key INTEGER NOT NULL REFERENCES dw.dim_presentacion(presentacion_key),
  zona_key         INTEGER NOT NULL REFERENCES dw.dim_zona(zona_key),
  pedido_id        INTEGER,
  origen           VARCHAR(10) NOT NULL CHECK (origen IN ('pedido','demo')),
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  ingreso          NUMERIC(12,2) NOT NULL,
  costo            NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS fact_ventas_fecha_idx ON dw.fact_ventas (fecha_key);
CREATE INDEX IF NOT EXISTS fact_ventas_origen_idx ON dw.fact_ventas (origen);
CREATE TABLE IF NOT EXISTS dw.carga_log (
  id         SERIAL PRIMARY KEY,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo       VARCHAR(20) NOT NULL,
  filas      INTEGER NOT NULL,
  detalle    VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS recuperaciones_password (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expira_en  TIMESTAMPTZ NOT NULL,
  usado_en   TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recuperaciones_usuario_idx ON recuperaciones_password (usuario_id, creado_en);
