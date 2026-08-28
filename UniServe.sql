-- =========================================================================
--  UniServe Database
--  Office of Student Services (OSS UniServe) — full relational schema
--  Mirrors the data model currently implemented in localStorage across
--  Landing/landing.js, Admin/admin.js, Super Admin/superadmin.js, User/user.js
--
--  Engine   : MySQL 8.0+ / MariaDB 10.5+
--  Charset  : utf8mb4
-- =========================================================================

DROP DATABASE IF EXISTS UniServe;
CREATE DATABASE UniServe
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE UniServe;

SET FOREIGN_KEY_CHECKS = 0;

-- =========================================================================
-- 1. USERS  (staff accounts — Super Admin / Admin)
-- =========================================================================
CREATE TABLE users (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    username        VARCHAR(50)     NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,
    full_name       VARCHAR(120)    NOT NULL,
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
CREATE TABLE services (
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
CREATE TABLE service_requirements (
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
CREATE TABLE transactions (
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

CREATE TABLE transaction_attachments (
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
CREATE TABLE appointments (
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

CREATE TABLE appointment_attachments (
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
CREATE TABLE queues (
    id                  VARCHAR(20)     NOT NULL PRIMARY KEY,
    queue_number         VARCHAR(20)     NOT NULL,   -- e.g. A-003, G-011
    prefix              VARCHAR(5)      NOT NULL,
    seq                 INT             NOT NULL,
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
    FOREIGN KEY (assigned_admin_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    UNIQUE KEY uq_queue_number_day (queue_number, created_at),
    INDEX idx_queue_status (status),
    INDEX idx_queue_created (created_at),
    INDEX idx_queue_admin (assigned_admin_id)
) ENGINE=InnoDB;

-- link appointments -> queues now that queues exists
ALTER TABLE appointments
    ADD CONSTRAINT fk_appt_queue
    FOREIGN KEY (queue_id) REFERENCES queues(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- daily per-prefix sequence counters (drives nextQueueNumber())
CREATE TABLE queue_counters (
    day_key         DATE            NOT NULL,
    prefix          VARCHAR(5)      NOT NULL,
    last_seq        INT             NOT NULL DEFAULT 0,
    PRIMARY KEY (day_key, prefix)
) ENGINE=InnoDB;

-- =========================================================================
-- 6. INCIDENT REPORTS  (confidential — OSS admin only)
-- =========================================================================
CREATE TABLE incidents (
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
CREATE TABLE scholarships (
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
CREATE TABLE chats (
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

CREATE TABLE chat_messages (
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

CREATE TABLE chat_message_attachments (
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
CREATE TABLE activity_log (
    id              VARCHAR(20)     NOT NULL PRIMARY KEY,
    user_id         VARCHAR(20)     NULL,
    user_name_text  VARCHAR(150)    NOT NULL,   -- snapshot of the name at the time
    role_text       VARCHAR(30)     NOT NULL,   -- snapshot of the role at the time
    action          VARCHAR(500)    NOT NULL,
    logged_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_log_user (user_id),
    INDEX idx_log_time (logged_at)
) ENGINE=InnoDB;

-- =========================================================================
-- 10. SYSTEM SETTINGS  (single-row configuration table)
-- =========================================================================
CREATE TABLE system_settings (
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

-- =========================================================================
--  SEED DATA — mirrors freshState() + seedDemoData() from the JS app
-- =========================================================================

-- ---- users (demo accounts) ----
-- NOTE: password_hash values below are PLAINTEXT placeholders matching the
-- JS demo ('admin123' / '1234'). In production, store bcrypt/argon2 hashes
-- instead — never plaintext passwords.
INSERT INTO users (id, username, password_hash, full_name, role, is_active) VALUES
('u1', 'admin',       'admin123', 'System Administrator', 'SUPER_ADMIN', TRUE),
('u2', 'oss.admin',   '1234',     'Maria Santos',          'ADMIN',       TRUE),
('u3', 'oss.admin2',  '1234',     'Dr. Ramon Cruz',        'ADMIN',       TRUE);

-- ---- services (default catalog) ----
INSERT INTO services (svc_key, label, icon, description, sort_order) VALUES
('good_moral',        'Good Moral Character',                'cap',     'Certification of good standing for scholarships, transfers or employment.', 1),
('student_id',        'Student ID-Related Requests',         'idcard',  'Replacement or first-time issuance of a student identification card.', 2),
('incident_report',   'Incident Reports',                    'alert',   'Report and document an incident for OSS review and action.', 3),
('excuse_letter',     'Excuse Letters',                       'checkin', 'Official excuse documentation for class or activity absences.', 4),
('scholarship_txn',   'Scholarship Transactions',            'cap',     'Scholarship application, renewal or documentation requests.', 5),
('concern',           'Student Concerns/Complaints',         'alert',   'Raise a concern or complaint for OSS review and action.', 6),
('offcampus',         'Off-Campus Activity Requests',        'calendar','Permission and documentation for off-campus student activities.', 7),
('activity_approval', 'Activity Approval',                    'checkin', 'Approval request for a planned school or student activity.', 8),
('orgevent',          'Organization Activities/Events',      'users',   'Approval workflow for student organization events on or off campus.', 9),
('sportsevent',       'Sports Events',                        'chart',   'Coordination and approval for sports competitions and away games.', 10),
('lost_document',     'Lost Certificate/Document Requests',  'folder',  'Re-issuance or certification for lost school records.', 11),
('other',             'Other Student Services Documentation','home',    'Any other OSS request not covered by the categories above.', 12);

-- ---- service requirements ----
INSERT INTO service_requirements (svc_key, requirement, sort_order) VALUES
('good_moral', 'Valid School ID', 1),
('good_moral', 'Duly accomplished request form', 2),
('student_id', 'Affidavit of Loss (if lost)', 1),
('student_id', '1x1 recent ID picture', 2),
('incident_report', 'Written incident statement', 1),
('incident_report', 'Valid ID', 2),
('excuse_letter', 'Medical certificate or proof of absence', 1),
('scholarship_txn', 'Certificate of Grades', 1),
('scholarship_txn', 'Financial assistance application form', 2),
('concern', 'Written statement of the concern', 1),
('offcampus', 'Parent/Guardian consent form', 1),
('offcampus', 'Activity proposal', 2),
('activity_approval', 'Activity proposal', 1),
('activity_approval', 'Adviser/Head endorsement', 2),
('orgevent', 'Activity proposal', 1),
('orgevent', 'Adviser endorsement letter', 2),
('sportsevent', 'Coach endorsement', 1),
('sportsevent', 'Player/participant list', 2),
('lost_document', 'Affidavit of Loss', 1),
('lost_document', 'Valid ID', 2),
('other', 'Supporting document, if applicable', 1);

-- ---- system settings (single row) ----
INSERT INTO system_settings (id, org_name, support_email, support_phone, timezone,
    maintenance_mode, auto_close_chats, session_timeout_minutes,
    queue_prefix_student, queue_prefix_guest)
VALUES (1, 'Office of Student Services', 'oss@university.edu.ph', '0917-000-0000',
    'Asia/Manila', FALSE, FALSE, 30, 'A', 'G');

-- ---- demo transactions (mirrors seedDemoData) ----
INSERT INTO transactions (id, code, requestor_name, requestor_type, id_number, section_org, svc_key, details, status, created_at) VALUES
('T1001', 'OSS-3F7K2Q', 'Jomar Ibanez',          'Student', '2021-04123', 'BSIT-3A',     'good_moral',        'For scholarship application',              'Completed',  DATE_SUB(NOW(), INTERVAL 1 DAY)),
('T1002', 'OSS-9H2M4L', 'Carla Dizon',            'Student', '2022-01187', 'BSED-2B',     'student_id',        'Lost ID, requesting replacement',           'Processing', NOW()),
('T1003', 'OSS-6R8N3P', 'Enzo Marasigan',         'Student', '2020-09982', 'BSCE-4A',     'excuse_letter',     'Absence due to medical appointment',        'Approved',   NOW()),
('T1004', 'OSS-2X5V7T', 'Rhea Villaflor',         'Student', '2021-11045', 'BSBA-3C',     'offcampus',         'Immersion at City Hall - Aug 20',           'Pending',    NOW()),
('T1005', 'OSS-8K3J9Q', 'Kite Society',           'Student', 'ORG-0012',   'Org',         'orgevent',          'General Assembly, Aug 25',                  'Approved',   DATE_SUB(NOW(), INTERVAL 2 DAY)),
('T1006', 'OSS-4M7L2N', "Men's Basketball Team",  'Student', 'SPORTS-04',  'Athletics',   'sportsevent',       'Away game vs. Rival College',               'Pending',    NOW()),
('T1007', 'OSS-1Q9R5S', 'Noah Buenaflor',         'Student', '2019-07765', 'BSA-4B',      'lost_document',     'Lost TOR copy',                             'Completed',  DATE_SUB(NOW(), INTERVAL 3 DAY)),
('T1008', 'OSS-7T2W6X', 'Divine Aquino',          'Student', '2022-05678', 'BSN-1A',      'scholarship_txn',   'Financial Assistance Grant renewal',        'Pending',    DATE_SUB(NOW(), INTERVAL 1 DAY)),
('T1009', 'OSS-5Y8Z3A', 'Kite Society',           'Student', 'ORG-0012',   'Org',         'activity_approval', 'Approval for General Assembly venue',       'Approved',   DATE_SUB(NOW(), INTERVAL 2 DAY));

-- ---- demo appointments ----
INSERT INTO appointments (id, code, visitor_name, visitor_type, id_number, contact, service_text, appt_date, appt_time, status, created_at) VALUES
('A2001', 'APT-3F8K2M', 'Liza Fernandez',  'Guest',   NULL,          '0917-555-0199', 'Parent Consultation',   CURDATE(),                     '10:00 AM', 'Booked', NOW()),
('A2002', 'APT-9R2N5Q', 'Marco Villareal', 'Student', '2021-03321',  '0928-555-0142', 'Scholarship Inquiry',   CURDATE(),                     '2:00 PM',  'Booked', NOW()),
('A2003', 'APT-6X4T8L', 'Grace Uy',        'Guest',   NULL,          '0995-555-0177', 'Vendor Coordination',   DATE_ADD(CURDATE(), INTERVAL 1 DAY), '9:30 AM', 'Booked', NOW());

-- ---- demo incident reports ----
INSERT INTO incidents (id, code, reporter_name, involved, description, status, created_at) VALUES
('IR3001', 'INC-2K7M9P', 'Maria Santos',    '2021-08871 &middot; J. Delacruz', 'Minor altercation reported near the covered court during break time.', 'Under Review', DATE_SUB(NOW(), INTERVAL 1 DAY)),
('IR3002', 'INC-8Q3R5T', 'Dr. Ramon Cruz',  '2020-02234 &middot; A. Manlapig', 'Repeated tardiness flagged by class adviser, referred for counseling.', 'Resolved',     DATE_SUB(NOW(), INTERVAL 5 DAY));

-- ---- demo scholarship records ----
INSERT INTO scholarships (id, student_name, id_number, program, doc_label, status, created_at) VALUES
('SCH4001', 'Jomar Ibanez',   '2021-04123', 'Academic Scholarship',          'Grade Report + Good Moral',    'Approved', DATE_SUB(NOW(), INTERVAL 6 DAY)),
('SCH4002', 'Divine Aquino',  '2022-05678', 'Financial Assistance Grant',    'Certificate of Indigency',     'Pending',  DATE_SUB(NOW(), INTERVAL 1 DAY));

-- ---- demo chats + messages ----
INSERT INTO chats (id, code, visitor_name, visitor_type, contact, status, staff_unread, visitor_unread, created_at, updated_at) VALUES
('CH5001', 'CHT-4N8K2R', 'Divine Aquino', 'Student', '0917-555-0212', 'Open', 1, 0, NOW(), NOW()),
('CH5002', 'CHT-7T3M9Q', 'Grace Uy',      'Guest',   '0995-555-0177', 'Open', 0, 0, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY));

INSERT INTO chat_messages (id, chat_id, sender, sender_name, message_text, sent_at) VALUES
('MSG6001', 'CH5001', 'visitor', 'Divine Aquino', 'Hi, may I ask about the status of my scholarship application?', NOW()),
('MSG6002', 'CH5002', 'visitor', 'Grace Uy',      'Good day, can I confirm our vendor coordination meeting time tomorrow?', DATE_SUB(NOW(), INTERVAL 1 DAY)),
('MSG6003', 'CH5002', 'staff',   'Maria Santos',  'Yes, 9:30 AM at the OSS front desk. See you then!', DATE_SUB(NOW(), INTERVAL 1 DAY));

-- ---- activity log ----
INSERT INTO activity_log (id, user_id, user_name_text, role_text, action, logged_at) VALUES
('L7001', 'u1', 'System Administrator', 'SUPER_ADMIN', 'System initialized', DATE_SUB(NOW(), INTERVAL 7 DAY));

-- =========================================================================
--  Convenience views
-- =========================================================================

-- Today's queue snapshot with human-readable service label
CREATE OR REPLACE VIEW v_todays_queue AS
SELECT
    q.id, q.queue_number, q.visitor_type,
    COALESCE(q.service_label_text, s.label, 'General Concern') AS service_label,
    q.source, q.status, q.visitor_name, q.assigned_admin_name,
    q.created_at, q.called_at, q.serving_at, q.completed_at
FROM queues q
LEFT JOIN services s ON s.svc_key = q.svc_key
WHERE DATE(q.created_at) = CURDATE();

-- Transaction counts by service (used by Reports / Manage Services)
CREATE OR REPLACE VIEW v_transactions_by_service AS
SELECT s.svc_key, s.label, COUNT(t.id) AS transaction_count
FROM services s
LEFT JOIN transactions t ON t.svc_key = s.svc_key
GROUP BY s.svc_key, s.label;

-- Open (unread) chat summary for staff sidebar badge
CREATE OR REPLACE VIEW v_open_chats_summary AS
SELECT COUNT(*) AS open_chats, COALESCE(SUM(staff_unread), 0) AS total_staff_unread
FROM chats
WHERE status = 'Open';