ALTER TABLE `reppo_queue` ADD `simulated` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reppo_queue` ADD `offline` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reppo_queue` ADD `category` text;
--> statement-breakpoint
ALTER TABLE `reppo_queue` ADD `settlement_minutes` integer DEFAULT 15 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reppo_queue` ADD `submit_started_at` text;
--> statement-breakpoint
ALTER TABLE `reppo_queue` ADD `settled_at` text;
--> statement-breakpoint
ALTER TABLE `reppo_queue` ADD `result_json` text;
--> statement-breakpoint
DROP INDEX `reppo_queue_one_pending_account_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `reppo_queue_one_active_account_unique` ON `reppo_queue` (`account_id`) WHERE `status` in ('submitting', 'pending', 'reconciliation_required', 'blocked');
--> statement-breakpoint
CREATE TABLE `reppo_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`queue_id` integer NOT NULL REFERENCES `reppo_queue`(`id`) ON DELETE CASCADE,
	`operation` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text,
	`http_status` integer,
	`error` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `reppo_calls_queue_started_idx` ON `reppo_calls` (`queue_id`,`started_at`);
