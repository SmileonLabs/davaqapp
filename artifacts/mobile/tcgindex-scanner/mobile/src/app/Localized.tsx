import React, { forwardRef } from "react";
import { Text as NativeText, type TextProps } from "react-native";
export { TextInput, Alert } from "react-native";
export const Text = forwardRef<NativeText, TextProps & { translate?: boolean }>(
  ({ translate: _translate, ...props }, ref) => (
    <NativeText {...props} ref={ref} />
  ),
);
