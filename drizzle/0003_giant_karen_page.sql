CREATE TABLE `ip_blacklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`reason` text,
	`manuallyUnlocked` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ip_blacklist_id` PRIMARY KEY(`id`),
	CONSTRAINT `ip_blacklist_ipAddress_unique` UNIQUE(`ipAddress`)
);
--> statement-breakpoint
ALTER TABLE `angle_attempts` ADD `isRepeatedOffender` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `userAgent` text;--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `country` varchar(100);--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `city` varchar(100);