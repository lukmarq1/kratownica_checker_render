CREATE TABLE `user_device_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`totalAttempts` int NOT NULL DEFAULT 0,
	`successfulAttempts` int NOT NULL DEFAULT 0,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`successRate` varchar(10),
	`country` varchar(100),
	`city` varchar(100),
	`latitude` varchar(20),
	`longitude` varchar(20),
	`isp` varchar(100),
	`browserFamily` varchar(50),
	`osFamily` varchar(50),
	`deviceType` varchar(50),
	`userAgents` text,
	`lastAttemptAt` timestamp,
	`firstAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_device_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_device_profiles_ipAddress_unique` UNIQUE(`ipAddress`)
);
--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `latitude` varchar(20);--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `longitude` varchar(20);--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `isp` varchar(100);--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `browserFamily` varchar(50);--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `osFamily` varchar(50);--> statement-breakpoint
ALTER TABLE `attempt_history` ADD `deviceType` varchar(50);