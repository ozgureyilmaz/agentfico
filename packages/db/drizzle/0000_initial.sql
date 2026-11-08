CREATE TABLE `events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`subject_afc_id` text NOT NULL,
	`source` text NOT NULL,
	`simulated` integer NOT NULL,
	`attestation` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`evidence_hash` text,
	`event_json` text NOT NULL,
	CONSTRAINT `events_simulated_bool_check` CHECK (`events`.`simulated` in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `events_subject_time_idx` ON `events` (`subject_afc_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `events_subject_type_idx` ON `events` (`subject_afc_id`,`event_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_subject_type_evidence_unique` ON `events` (`subject_afc_id`,`event_type`,`evidence_hash`);
--> statement-breakpoint
CREATE TABLE `scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`afc_id` text NOT NULL,
	`score` integer,
	`band` text,
	`confidence` text NOT NULL,
	`status` text NOT NULL,
	`model_version` text NOT NULL,
	`as_of` text NOT NULL,
	`simulated_share` real NOT NULL,
	`factors_json` text NOT NULL,
	`reason_codes_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scores_afc_as_of_idx` ON `scores` (`afc_id`,`as_of`);
--> statement-breakpoint
CREATE TABLE `verdicts` (
	`eval_id` text PRIMARY KEY NOT NULL,
	`afc_id` text NOT NULL,
	`status` text NOT NULL,
	`score` real,
	`decision` text,
	`confidence` text,
	`result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verdicts_afc_status_idx` ON `verdicts` (`afc_id`,`status`);
--> statement-breakpoint
CREATE TABLE `serv_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`job` integer NOT NULL,
	`afc_id` text,
	`model` text NOT NULL,
	`features_json` text NOT NULL,
	`tools_json` text NOT NULL,
	`response_id` text,
	`status` text NOT NULL,
	`offline` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer,
	`usage_json` text,
	`cost_json` text,
	`prompt_guard_json` text,
	`shadow_agent_json` text,
	`input_sha256` text NOT NULL,
	`output_sha256` text,
	`output_preview` text,
	CONSTRAINT `serv_calls_job_range_check` CHECK (`serv_calls`.`job` between 1 and 7)
);
--> statement-breakpoint
CREATE INDEX `serv_calls_afc_created_idx` ON `serv_calls` (`afc_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `serv_calls_job_created_idx` ON `serv_calls` (`job`,`created_at`);
--> statement-breakpoint
CREATE TABLE `reppo_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`afc_id` text NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`criteria_json` text NOT NULL,
	`context_json` text,
	`eval_id` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_poll_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reppo_queue_status_created_idx` ON `reppo_queue` (`status`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `reppo_queue_one_pending_account_unique` ON `reppo_queue` (`account_id`) WHERE `status` = 'pending';
