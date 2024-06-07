import type { MultiSelectProps, SelectItemProps } from "@mantine/core";
import { MultiSelect, Tooltip } from "@mantine/core";
import { useUncontrolled } from "@mantine/hooks";
import type { ClipboardEvent, FocusEvent, ReactNode } from "react";
import { useMemo, useState, useCallback, forwardRef } from "react";
import { t } from "ttag";

import { color } from "metabase/lib/colors";
import { Icon } from "metabase/ui";

import type { Base, SelectItem, FilterFn } from "./types";
import { parseValues, unique } from "./utils";

export type MultiAutocompleteProps<ValueType extends Base> = Omit<
  MultiSelectProps,
  "shouldCreate" | "data" | "filter" | "defaultValue" | "value" | "onChange"
> & {
  shouldCreate?: (value: ValueType, selectedValues: ValueType[]) => boolean;
  filter?: FilterFn<ValueType>;
  data?: ReadonlyArray<ValueType | SelectItem<ValueType>>;
  defaultValue?: ValueType[];
  parseValue?: (str: string) => ValueType | null;
  value?: ValueType[];
  onChange?: (value: ValueType[]) => void;
  renderValue?: (value: ValueType) => ReactNode;
};

export function MultiAutocomplete<ValueType extends Base>({
  data = [],
  value: controlledValue,
  defaultValue,
  searchValue: controlledSearchValue,
  placeholder,
  autoFocus,
  shouldCreate = defaultShouldCreate,
  onChange,
  onSearchChange,
  onFocus,
  onBlur,
  prefix,
  filter = defaultFilter,
  parseValue = defaultParseValue,
  renderValue,
  ...props
}: MultiAutocompleteProps<ValueType>) {
  const [selectedValues, setSelectedValues] = useUncontrolled<ValueType[]>({
    value: controlledValue,
    defaultValue,
    finalValue: [],
    onChange,
  });
  const [searchValue, setSearchValue] = useUncontrolled({
    value: controlledSearchValue,
    finalValue: "",
    onChange: onSearchChange,
  });

  const [lastSelectedValues, setLastSelectedValues] =
    useState<ValueType[]>(selectedValues);

  const [isFocused, setIsFocused] = useState(false);
  const visibleValues = isFocused ? lastSelectedValues : [...selectedValues];

  const items = useMemo(
    () => getAvailableSelectItems(data, lastSelectedValues),
    [data, lastSelectedValues],
  );

  const handleChange = (newValues: ValueType[]) => {
    const values = unique(newValues);
    setSelectedValues(values);
    setLastSelectedValues(values);
  };

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    setLastSelectedValues(selectedValues);
    onFocus?.(event);
  };

  function isValid(value: ValueType | null) {
    return (
      value !== null &&
      value !== "" &&
      !Number.isNaN(value) &&
      shouldCreate?.(value, lastSelectedValues)
    );
  }

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);

    const values = parseValues(searchValue, parseValue);
    const validValues = values.filter(isValid);

    setSearchValue("");

    if (validValues.length > 0) {
      const newValues = unique([...lastSelectedValues, ...validValues]);
      setSelectedValues(newValues);
      setLastSelectedValues(newValues);
    } else {
      setSelectedValues(lastSelectedValues);
    }

    onBlur?.(event);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();

    const input = event.target as HTMLInputElement;
    const value = input.value;
    const before = value.slice(0, input.selectionStart ?? value.length);
    const after = value.slice(input.selectionEnd ?? value.length);

    const pasted = event.clipboardData.getData("text");
    const text = `${before}${pasted}${after}`;

    const values = parseValues(text, parseValue);
    const validValues = values.filter(isValid);

    if (values.length > 0) {
      const newValues = unique([...lastSelectedValues, ...validValues]);
      setSelectedValues(newValues);
      setLastSelectedValues(newValues);
      setSearchValue("");
    } else {
      setSearchValue(text);
    }
  };

  const handleSearchChange = (newSearchValue: string) => {
    const first = newSearchValue.at(0);
    const last = newSearchValue.at(-1);

    setSearchValue(newSearchValue);

    if (newSearchValue !== "") {
      const values = parseValues(newSearchValue, parseValue);
      if (values.length >= 1) {
        const value = values[0] ?? newSearchValue;
        if (isValid(value)) {
          setSelectedValues(unique([...lastSelectedValues, value]));
        }
      }
    }
    if (newSearchValue === "") {
      setSelectedValues(unique([...lastSelectedValues]));
    }

    const quotes = Array.from(newSearchValue).filter(ch => ch === '"').length;

    if (
      (last === "," && quotes % 2 === 0) ||
      last === "\t" ||
      last === "\n" ||
      (first === '"' && last === '"')
    ) {
      const values = parseValues(newSearchValue, parseValue);
      const validValues = values.filter(isValid);

      if (values.length > 0) {
        setSearchValue("");
      }

      if (validValues.length > 0) {
        const newValues = unique([...lastSelectedValues, ...validValues]);
        setSelectedValues(newValues);
        setLastSelectedValues(newValues);
        setSearchValue("");
      }
    }
  };

  const info = isFocused ? (
    <Tooltip
      label={
        <>
          {t`Separate values with commas, tabs or newlines.`}
          <br />
          {t` Use double quotes for values containing commas.`}
        </>
      }
    >
      <Icon name="info_filled" fill={color("text-light")} />
    </Tooltip>
  ) : (
    <span />
  );

  const CustomItemComponent = useCallback(
    (props: SelectItemProps) => {
      const customLabel =
        props.value !== undefined && renderValue?.(props.value as ValueType);
      return <ItemWrapper {...props} label={customLabel ?? props.label} />;
    },
    [renderValue],
  );

  return (
    <MultiSelect
      {...props}
      // @ts-expect-error: Mantine's types expects a string value,
      // but does not depend on it being a string
      data={items}
      // @ts-expect-error: see above
      value={visibleValues}
      searchValue={searchValue}
      placeholder={placeholder}
      searchable
      autoFocus={autoFocus}
      // @ts-expect-error: see above
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onSearchChange={handleSearchChange}
      onPaste={handlePaste}
      rightSection={info}
      icon={prefix && <span data-testid="input-prefix">{prefix}</span>}
      // @ts-expect-error: see above
      filter={filter as FilterFn<ValueType>}
      itemComponent={CustomItemComponent}
    />
  );
}

function getSelectItem<ValueType extends Base>(
  item: ValueType | SelectItem<ValueType>,
): SelectItem<ValueType> {
  if (typeof item === "string") {
    return { value: item, label: item };
  }

  if (typeof item === "number") {
    return { value: item, label: item.toString() };
  }

  if (!item.label) {
    return { value: item.value, label: item.value?.toString() ?? "" };
  }

  return item;
}

function getAvailableSelectItems<ValueType extends Base>(
  data: ReadonlyArray<ValueType | SelectItem<ValueType>>,
  selectedValues: ValueType[],
) {
  const all = [...data, ...selectedValues].map(getSelectItem);
  const seen = new Set();

  // Deduplicate items based on value
  return all.filter(function (option) {
    if (seen.has(option.value)) {
      return false;
    }
    seen.add(option.value);
    return true;
  });
}

function defaultShouldCreate<ValueType extends Base>(
  value: ValueType,
  selectedValues: ValueType[],
) {
  if (typeof value === "number") {
    return !selectedValues.some(selectedValue => selectedValue === value);
  }

  return (
    value.trim().length > 0 &&
    !selectedValues.some(selectedValue => selectedValue === value)
  );
}

function defaultFilter<ValueType extends Base>(
  query: string,
  selected: boolean,
  item: SelectItem<ValueType>,
): boolean {
  if (selected || !item.label) {
    return false;
  }
  return item.label.toLowerCase().trim().includes(query.toLowerCase().trim());
}

function defaultParseValue<ValueType extends Base>(
  str: string,
): ValueType | null {
  // @ts-expect-error: for the default case we ignore the type
  return str;
}

export const ItemWrapper = forwardRef<HTMLDivElement, SelectItemProps>(
  function ItemWrapper({ label, value, ...others }, ref) {
    return (
      <div ref={ref} {...others}>
        {label || value}
      </div>
    );
  },
);
