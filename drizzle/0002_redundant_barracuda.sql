CREATE TABLE `attempt_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`angle` varchar(10) NOT NULL,
	`isCorrect` int NOT NULL,
	`attemptNumber` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attempt_history_id` PRIMARY KEY(`id`)
);
