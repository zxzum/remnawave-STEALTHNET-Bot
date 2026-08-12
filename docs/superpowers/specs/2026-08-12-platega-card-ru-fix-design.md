# Platega CardRu method fix

## Goal

Make Russian card payments use Platega's documented `CardRu` method (`10`) while preserving the working SBP method (`2`).

## Design

Change the backend and admin defaults from card method `11` to `10`. Normalize an existing persisted method `11` labeled `Карты` to `10` when the backend parses `platega_methods`, so deployments with the old saved setting do not require manual SQL or an admin save. Add one focused regression test for that normalization and leave the existing Platega endpoint, redirect handling, and webhook flow unchanged.

## Reference

Platega's current API documentation lists `2` as SBP / QR, `10` as `CardRu`, and `12` as International. The current integration already uses `POST /transaction/process` and reads the documented `redirect` and `transactionId` response fields.

## Out of scope

The Telegram URL `beastvpn_xbot` is not present in the repository and is not changed without a production Platega response or runtime setting proving its origin.
