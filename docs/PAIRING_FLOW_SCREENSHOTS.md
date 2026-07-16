# Pairing flow walkthrough

These screenshots use a real Round 1 test session between Hunter and the `not hunter` burner account. The flow is the same for participants.

## 1. Opt in for the round

The bot posts and DMs the round opt-in before matching. **I'm in this round** requests the normal one interview in each role. **In + catch-up double** requests extra work to catch up, **In + standby for extras** makes the participant available if another person needs a partner, and **Sitting out** skips the round without a penalty.

The posted date is when the initial pairings are published—not an opt-in deadline. Opt-in stays open afterward, and late participants are matched first come, first served as compatible partners become available.

![Round opt-in message](screenshots/pairing-guide/00-opt-in-message.png)

## 2. Pairing is released

Both participants receive a short Discord DM identifying their role and partner. The private session thread is the source of truth for scheduling.

![Pairing DM](screenshots/pairing-guide/02-pairing-dm.png)

The session thread includes the participants, their roles, the report deadline, and the steps to schedule.

![Pairing thread](screenshots/pairing-guide/01-pairing-thread-detail.png)

## 3. Either participant chooses a time

The **Choose a time** button opens a Discord modal. Participants select a valid date in the current round and enter a Toronto time using the 24-hour clock.

Before a time is confirmed, **Partner not responding** reports a scheduling ghost and puts the reporting participant into the priority re-pair queue. **Can't make it** records that the person cancelling cannot participate and re-queues their partner.

![Schedule modal](screenshots/pairing-guide/03-schedule-modal-detail.png)

## 4. The time is confirmed

The confirmed time is posted in the private thread. Either participant can use **Reschedule time** if plans change.

![Scheduled session](screenshots/pairing-guide/04-scheduled-thread-detail.png)

## 5. The interviewer receives the problem packet

As soon as the time is confirmed, the interviewer receives the pre-assigned problem packet by DM. The interviewee does not receive the packet.

![Interviewer packet DM](screenshots/pairing-guide/05-interviewer-packet.png)

## 6. Discord sends the interview reminder

Shortly before the interview, each participant receives a role-specific DM with the session time, their role, and their feedback-form link. The private thread is updated at the same time.

![Role-specific reminder DM](screenshots/pairing-guide/06-pre-interview-reminder.png)

![Session thread reminder](screenshots/pairing-guide/07-reminder-thread.png)

## 7. Feedback forms are released

At the scheduled start time, Discord reminds both participants that their role-specific forms are ready. The dashboard also reflects which submission is still outstanding and shows the session as complete only after both reports are submitted.

The feedback form asks whether each person attended. Answering that the partner did not attend automatically records the confirmed-time no-show and puts the reporting participant into the priority re-pair queue; a no-show is not part of the pre-scheduling controls.
