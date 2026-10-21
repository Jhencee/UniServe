-- Import through phpMyAdmin or mysql --user=root < QUERY.SQL.
-- Rerunnable: preserves existing data and changed passwords. Includes initial staff accounts.
-- staff_users stores OSS staff; users stores Laravel authentication accounts.

-- =========================================================================
--  UniServe Database
--  Office of Student Services (OSS UniServe) — full relational schema
--  Mirrors the data model currently implemented in localStorage across
--  Landing/landing.js, Admin/admin.js, Super Admin/superadmin.js, User/user.js
--
--  Engine   : MySQL 8.0+ / MariaDB 10.5+
--  Charset  : utf8mb4
-- =========================================================================

CREATE DATABASE IF NOT EXISTS UniServe
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE UniServe;

SET FOREIGN_KEY_CHECKS = 0;

-- =========================================================================
-- 1. USERS  (staff accounts — Super Admin / Admin)
-- =========================================================================
CREATE TABLE IF NOT EXISTS staff_users (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    username        VARCHAR(50)     NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,
    full_name       VARCHAR(120)    NOT NULL,
    email           VARCHAR(120)    NULL UNIQUE,
    confidential_access BOOLEAN     NOT NULL DEFAULT FALSE,
    role            ENUM('SUPER_ADMIN','ADMIN') NOT NULL DEFAULT 'ADMIN',
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_role (role),
    INDEX idx_users_active (is_active)
) ENGINE=InnoDB;

-- =========================================================================
-- 2. SERVICES  (service catalog shown on Visitor Portal / Manage Services)
-- =========================================================================
CREATE TABLE IF NOT EXISTS services (
    svc_key         VARCHAR(50)     NOT NULL PRIMARY KEY,
    label           VARCHAR(150)    NOT NULL,
    icon            VARCHAR(30)     NOT NULL DEFAULT 'home',
    description     TEXT            NULL,
    sort_order      INT             NOT NULL DEFAULT 0,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- one-to-many: each service can list several requirement lines
CREATE TABLE IF NOT EXISTS service_requirements (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    svc_key         VARCHAR(50)     NOT NULL,
    requirement     VARCHAR(255)    NOT NULL,
    sort_order      INT             NOT NULL DEFAULT 0,
    FOREIGN KEY (svc_key) REFERENCES services(svc_key)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_svcreq_svc (svc_key)
) ENGINE=InnoDB;

-- =========================================================================
-- 3. TRANSACTIONS  (student/guest service requests logged at Check-In,
--    Transactions module, or generated from a checked-in appointment)
-- =========================================================================
CREATE TABLE IF NOT EXISTS transactions (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL UNIQUE,
    requestor_name  VARCHAR(150)    NOT NULL,
    requestor_type  ENUM('Student','Guest') NOT NULL DEFAULT 'Student',
    id_number       VARCHAR(50)     NULL,
    section_org     VARCHAR(100)    NULL,
    svc_key         VARCHAR(50)     NULL,
    details         TEXT            NULL,
    status          ENUM('Pending','Processing','Approved','Completed','Rejected')
                                     NOT NULL DEFAULT 'Pending',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (svc_key) REFERENCES services(svc_key)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_txn_status (status),
    INDEX idx_txn_service (svc_key),
    INDEX idx_txn_created (created_at),
    INDEX idx_txn_name (requestor_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transaction_attachments (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id  VARCHAR(20)     NOT NULL,
    file_name       VARCHAR(255)    NOT NULL,
    file_size       INT             NOT NULL,   -- bytes
    file_type       VARCHAR(100)    NULL,
    file_path       VARCHAR(500)    NOT NULL,   -- storage path or data URL ref
    uploaded_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_txnatt_txn (transaction_id)
) ENGINE=InnoDB;

-- =========================================================================
-- 4. APPOINTMENTS  (booked visits / visitor pass; may spawn a queue entry
--    and a transaction once checked in)
-- =========================================================================
CREATE TABLE IF NOT EXISTS appointments (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL UNIQUE,
    visitor_name    VARCHAR(150)    NOT NULL,
    visitor_type    ENUM('Student','Guest') NOT NULL DEFAULT 'Student',
    id_number       VARCHAR(50)     NULL,
    contact         VARCHAR(50)     NULL,
    service_text    VARCHAR(150)    NOT NULL,   -- free-text service label at booking time
    appt_date       DATE            NOT NULL,
    appt_time       VARCHAR(20)     NOT NULL,   -- display format e.g. "9:00 AM"
    status          ENUM('Booked','Checked-in','Cancelled') NOT NULL DEFAULT 'Booked',
    queue_id        VARCHAR(20)     NULL,       -- set once checked in
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_appt_date (appt_date),
    INDEX idx_appt_status (status),
    INDEX idx_appt_name (visitor_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointment_attachments (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id  VARCHAR(20)     NOT NULL,
    file_name       VARCHAR(255)    NOT NULL,
    file_size       INT             NOT NULL,
    file_type       VARCHAR(100)    NULL,
    file_path       VARCHAR(500)    NOT NULL,
    uploaded_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_apptatt_appt (appointment_id)
) ENGINE=InnoDB;

-- =========================================================================
-- 5. QUEUES  (live service queue — walk-in, appointment check-in, priority)
-- =========================================================================
CREATE TABLE IF NOT EXISTS queues (
    id                  VARCHAR(20)     NOT NULL PRIMARY KEY,
    queue_number         VARCHAR(20)     NOT NULL,   -- e.g. A-003, G-011
    prefix              VARCHAR(5)      NOT NULL,
    seq                 INT             NOT NULL,
    portal_payload      JSON            NULL,
    visitor_type        ENUM('Student','Guest') NOT NULL DEFAULT 'Student',
    svc_key             VARCHAR(50)     NULL,
    service_label_text  VARCHAR(150)    NULL,        -- snapshot label at time of entry
    source              ENUM('Priority','Appointment','Walk-in') NOT NULL DEFAULT 'Walk-in',
    visitor_name        VARCHAR(150)    NULL,
    id_number           VARCHAR(50)     NULL,
    contact             VARCHAR(50)     NULL,
    appointment_id      VARCHAR(20)     NULL,
    transaction_id      VARCHAR(20)     NULL,
    status              ENUM('Waiting','Called','Serving','Completed','Skipped','Cancelled')
                                         NOT NULL DEFAULT 'Waiting',
    assigned_admin_id   VARCHAR(20)     NULL,
    assigned_admin_name VARCHAR(120)    NULL,
    recall_count        INT             NOT NULL DEFAULT 0,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    called_at           DATETIME        NULL,
    serving_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    recalled_at         DATETIME        NULL,
    transferred_at       DATETIME        NULL,
    FOREIGN KEY (svc_key) REFERENCES services(svc_key)
        ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (assigned_admin_id) REFERENCES staff_users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    UNIQUE KEY uq_queue_number_day (queue_number, created_at),
    INDEX idx_queue_status (status),
    INDEX idx_queue_created (created_at),
    INDEX idx_queue_admin (assigned_admin_id)
) ENGINE=InnoDB;

-- link appointments -> queues now that queues exists
SET @queue_fk_sql = IF(
 EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'appointments'
 AND CONSTRAINT_NAME = 'fk_appt_queue'),
 'SELECT 1',
 'ALTER TABLE appointments ADD CONSTRAINT fk_appt_queue FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE queue_fk_stmt FROM @queue_fk_sql;
EXECUTE queue_fk_stmt;
DEALLOCATE PREPARE queue_fk_stmt;

-- daily per-prefix sequence counters (drives nextQueueNumber())
CREATE TABLE IF NOT EXISTS queue_counters (
    day_key         DATE            NOT NULL,
    prefix          VARCHAR(5)      NOT NULL,
    last_seq        INT             NOT NULL DEFAULT 0,
    PRIMARY KEY (day_key, prefix)
) ENGINE=InnoDB;

-- =========================================================================
-- 6. INCIDENT REPORTS  (confidential — OSS admin only)
-- =========================================================================
CREATE TABLE IF NOT EXISTS incidents (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL UNIQUE,
    reporter_name   VARCHAR(150)    NOT NULL,
    involved        VARCHAR(255)    NOT NULL,
    description     TEXT            NOT NULL,
    actions_taken   TEXT            NULL,
    status          ENUM('Under Review','Escalated','Resolved') NOT NULL DEFAULT 'Under Review',
    is_sensitive    BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_inc_status (status),
    INDEX idx_inc_created (created_at)
) ENGINE=InnoDB;

-- =========================================================================
-- 7. SCHOLARSHIP RECORDS  (confidential — OSS admin managed)
-- =========================================================================
CREATE TABLE IF NOT EXISTS scholarships (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    student_name    VARCHAR(150)    NOT NULL,
    id_number       VARCHAR(50)     NULL,
    program         VARCHAR(150)    NOT NULL DEFAULT 'General',
    doc_label       VARCHAR(255)    NULL,
    status          ENUM('Pending','Under Evaluation','Approved','Released') NOT NULL DEFAULT 'Pending',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sch_status (status),
    INDEX idx_sch_name (student_name)
) ENGINE=InnoDB;

-- =========================================================================
-- 8. CHATS  (visitor <-> staff messaging threads)
-- =========================================================================
CREATE TABLE IF NOT EXISTS chats (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL UNIQUE,
    visitor_name    VARCHAR(150)    NOT NULL,
    visitor_type    ENUM('Student','Guest') NOT NULL DEFAULT 'Student',
    contact         VARCHAR(50)     NULL,
    status          ENUM('Open','Closed') NOT NULL DEFAULT 'Open',
    staff_unread    INT             NOT NULL DEFAULT 0,
    visitor_unread  INT             NOT NULL DEFAULT 0,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_chat_status (status),
    INDEX idx_chat_updated (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_messages (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    chat_id         VARCHAR(20)     NOT NULL,
    sender          ENUM('visitor','staff') NOT NULL,
    sender_name     VARCHAR(150)    NULL,
    message_text    TEXT            NOT NULL,
    sent_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_msg_chat (chat_id),
    INDEX idx_msg_sent (sent_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_message_attachments (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    message_id      VARCHAR(20)     NOT NULL,
    file_name       VARCHAR(255)    NOT NULL,
    file_size       INT             NOT NULL,
    file_type       VARCHAR(100)    NULL,
    file_path       VARCHAR(500)    NOT NULL,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_msgatt_msg (message_id)
) ENGINE=InnoDB;

-- =========================================================================
-- 9. ACTIVITY LOG  (system-wide audit trail)
-- =========================================================================
CREATE TABLE IF NOT EXISTS activity_log (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    user_id         VARCHAR(20)     NULL,
    user_name_text  VARCHAR(150)    NOT NULL,   -- snapshot of the name at the time
    role_text       VARCHAR(30)     NOT NULL,   -- snapshot of the role at the time
    action          VARCHAR(500)    NOT NULL,
    logged_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES staff_users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_log_user (user_id),
    INDEX idx_log_time (logged_at)
) ENGINE=InnoDB;

-- =========================================================================
-- 10. SYSTEM SETTINGS  (single-row configuration table)
-- =========================================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id                      TINYINT     NOT NULL PRIMARY KEY DEFAULT 1,
    org_name                VARCHAR(150) NOT NULL DEFAULT 'Office of Student Services',
    support_email           VARCHAR(150) NOT NULL DEFAULT 'oss@university.edu.ph',
    support_phone           VARCHAR(30)  NOT NULL DEFAULT '0917-000-0000',
    timezone                VARCHAR(50)  NOT NULL DEFAULT 'Asia/Manila',
    maintenance_mode        BOOLEAN      NOT NULL DEFAULT FALSE,
    auto_close_chats        BOOLEAN      NOT NULL DEFAULT FALSE,
    session_timeout_minutes INT          NOT NULL DEFAULT 30,
    queue_prefix_student    VARCHAR(2)   NOT NULL DEFAULT 'A',
    queue_prefix_guest      VARCHAR(2)   NOT NULL DEFAULT 'G',
    updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_settings_single_row CHECK (id = 1)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;


-- Laravel infrastructure (matches backend/database/migrations).
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `users` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `email_verified_at` timestamp NULL DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `remember_token` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `email` varchar(255) NOT NULL,
  `token` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` varchar(255) NOT NULL,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `payload` longtext NOT NULL,
  `last_activity` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `sessions_user_id_index` (`user_id`),
  KEY `sessions_last_activity_index` (`last_activity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `cache` (
  `key` varchar(255) NOT NULL,
  `value` mediumtext NOT NULL,
  `expiration` bigint(20) NOT NULL,
  PRIMARY KEY (`key`),
  KEY `cache_expiration_index` (`expiration`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `cache_locks` (
  `key` varchar(255) NOT NULL,
  `owner` varchar(255) NOT NULL,
  `expiration` bigint(20) NOT NULL,
  PRIMARY KEY (`key`),
  KEY `cache_locks_expiration_index` (`expiration`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `jobs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `queue` varchar(255) NOT NULL,
  `payload` longtext NOT NULL,
  `attempts` smallint(5) unsigned NOT NULL,
  `reserved_at` int(10) unsigned DEFAULT NULL,
  `available_at` int(10) unsigned NOT NULL,
  `created_at` int(10) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `jobs_queue_index` (`queue`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `job_batches` (
  `id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `total_jobs` int(11) NOT NULL,
  `pending_jobs` int(11) NOT NULL,
  `failed_jobs` int(11) NOT NULL,
  `failed_job_ids` longtext NOT NULL,
  `options` mediumtext DEFAULT NULL,
  `cancelled_at` int(11) DEFAULT NULL,
  `created_at` int(11) NOT NULL,
  `finished_at` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `failed_jobs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(255) NOT NULL,
  `connection` varchar(255) NOT NULL,
  `queue` varchar(255) NOT NULL,
  `payload` longtext NOT NULL,
  `exception` longtext NOT NULL,
  `failed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `failed_jobs_uuid_unique` (`uuid`),
  KEY `failed_jobs_connection_queue_failed_at_index` (`connection`,`queue`,`failed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `migrations` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `migration` varchar(255) NOT NULL,
  `batch` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Record the bundled migrations so artisan migrate does not recreate tables.
INSERT INTO migrations (migration, batch)
SELECT '0001_01_01_000000_create_users_table', 1
WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE migration = '0001_01_01_000000_create_users_table');
INSERT INTO migrations (migration, batch)
SELECT '0001_01_01_000001_create_cache_table', 1
WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE migration = '0001_01_01_000001_create_cache_table');
INSERT INTO migrations (migration, batch)
SELECT '0001_01_01_000002_create_jobs_table', 1
WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE migration = '0001_01_01_000002_create_jobs_table');

-- Initial Admin accounts. Temporary password: 1234 (bcrypt hash).
-- Super Admin is stored in staff_users; its initial account is created below.
INSERT INTO staff_users (id, username, full_name, email, password_hash, role, is_active, confidential_access)
SELECT 'u2', 'oss.admin', 'Maria Santos', 'maria.santos@oss.edu.ph', '$2y$12$84./blmjsXG5.k7mb6NUg.2uZWK05UseAGEo/QagEjSmOsoRU4cAu', 'ADMIN', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM staff_users WHERE id = 'u2' OR username = 'oss.admin');
INSERT INTO staff_users (id, username, full_name, email, password_hash, role, is_active, confidential_access)
SELECT 'u3', 'oss.admin2', 'Dr. Ramon Cruz', 'ramon.cruz@oss.edu.ph', '$2y$12$84./blmjsXG5.k7mb6NUg.2uZWK05UseAGEo/QagEjSmOsoRU4cAu', 'ADMIN', TRUE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM staff_users WHERE id = 'u3' OR username = 'oss.admin2');
-- Initial Super Admin. This only creates a missing account; it never resets a changed password.
INSERT INTO staff_users (id, username, full_name, email, password_hash, role, is_active, confidential_access)
SELECT 'u1', 'admin', 'System Administrator', 'sysadmin@oss.edu.ph', '$2y$12$/VQpwz7dLCsf0g310CFiWeAtRGbTcCioy7Y/vyunBbPA.8MkialXK', 'SUPER_ADMIN', TRUE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM staff_users WHERE role = 'SUPER_ADMIN' OR id = 'u1' OR username = 'admin' OR email = 'sysadmin@oss.edu.ph');
