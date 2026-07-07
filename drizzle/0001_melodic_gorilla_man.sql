CREATE TABLE `angle_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`lockedUntil` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `angle_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `angle_attempts_ipAddress_unique` UNIQUE(`ipAddress`)
);
