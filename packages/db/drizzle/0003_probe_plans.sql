CREATE TABLE `probe_plans` (
  `id` text PRIMARY KEY NOT NULL REFERENCES `serv_calls` (`id`),
  `afc_id` text NOT NULL,
  `category` text NOT NULL,
  `created_at` text NOT NULL,
  `ready_at` text NOT NULL,
  `plan_json` text NOT NULL,
  `simulated` integer NOT NULL CHECK (`simulated` IN (0, 1)),
  `queue_id` integer REFERENCES `reppo_queue` (`id`)
);
