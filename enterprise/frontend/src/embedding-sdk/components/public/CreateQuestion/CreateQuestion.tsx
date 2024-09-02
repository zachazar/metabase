import {
  QuestionEditor,
  type QuestionEditorProps,
} from "embedding-sdk/components/private/QuestionEditor";

import type { InteractiveQuestionProps } from "../InteractiveQuestion";

type CreateQuestionProps = Pick<InteractiveQuestionProps, "plugins"> &
  QuestionEditorProps;

export const CreateQuestion = ({
  plugins,
  isSaveEnabled,
  models,
}: CreateQuestionProps = {}) => (
  <QuestionEditor
    plugins={plugins}
    isSaveEnabled={isSaveEnabled}
    models={models}
  />
);
