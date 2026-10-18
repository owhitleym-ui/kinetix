-- Form Check: accounts + per-session PT shares
-- Safe to re-run via migrate.js (duplicate-object errors are ignored).

CREATE TABLE users (
  user_id       VARCHAR2(64)  NOT NULL,
  email         VARCHAR2(320) NOT NULL,
  password_hash VARCHAR2(200) NOT NULL,
  display_name  VARCHAR2(200) NOT NULL,
  role          VARCHAR2(20)  NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT users_pk PRIMARY KEY (user_id),
  CONSTRAINT users_email_uk UNIQUE (email),
  CONSTRAINT users_role_ck CHECK (role IN ('patient', 'pt'))
);

ALTER TABLE patients ADD user_id VARCHAR2(64);

ALTER TABLE patients ADD CONSTRAINT patients_user_fk
  FOREIGN KEY (user_id) REFERENCES users (user_id);

ALTER TABLE patients ADD CONSTRAINT patients_user_uk UNIQUE (user_id);

CREATE TABLE session_shares (
  share_id         VARCHAR2(64) NOT NULL,
  session_id       VARCHAR2(64) NOT NULL,
  patient_user_id  VARCHAR2(64) NOT NULL,
  pt_user_id       VARCHAR2(64) NOT NULL,
  granted_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  revoked_at       TIMESTAMP WITH TIME ZONE,
  CONSTRAINT session_shares_pk PRIMARY KEY (share_id),
  CONSTRAINT session_shares_session_fk
    FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT session_shares_patient_fk
    FOREIGN KEY (patient_user_id) REFERENCES users (user_id),
  CONSTRAINT session_shares_pt_fk
    FOREIGN KEY (pt_user_id) REFERENCES users (user_id),
  CONSTRAINT session_shares_pair_uk UNIQUE (session_id, pt_user_id)
);

CREATE INDEX session_shares_pt_ix ON session_shares (pt_user_id, revoked_at);
CREATE INDEX session_shares_patient_ix ON session_shares (patient_user_id);
CREATE INDEX users_role_ix ON users (role);
