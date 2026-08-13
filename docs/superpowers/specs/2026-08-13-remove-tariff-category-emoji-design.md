# Remove Tariff Category Emoji From Cards

## Goal

Remove the duplicated category emoji from each tariff card in the Лазейка ВПН cabinet.

## Design

`mapTariffGroups` will build `emojiLine` only from the tariff description. The category emoji remains part of category data and is not deleted or changed in the admin panel, backend, or bot. Empty tariff descriptions produce an empty line and therefore no stray symbol.

## Testing

Update the existing model test to prove that a category emoji is not included while the complete tariff description is preserved. Run the focused model test and the frontend build.
