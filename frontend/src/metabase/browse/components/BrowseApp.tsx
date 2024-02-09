import { t } from "ttag";
import { push } from "react-router-redux";
import { Flex, Icon, Text } from "metabase/ui";
import {
  useDatabaseListQuery,
  useSearchListQuery,
} from "metabase/common/hooks";
import type { SearchResult } from "metabase-types/api";
import { useDispatch } from "metabase/lib/redux";
import LoadingAndErrorWrapper from "metabase/components/LoadingAndErrorWrapper";
import Link from "metabase/core/components/Link";
import { BrowseDatabases } from "./BrowseDatabases";
import { BrowseModels } from "./BrowseModels";
import {
  BrowseAppRoot,
  BrowseContainer,
  BrowseDataHeader,
  BrowseSectionContainer,
  BrowseTab,
  BrowseTabs,
  BrowseTabsContainer,
  BrowseTabsList,
  BrowseTabsPanel,
} from "./BrowseApp.styled";
import { BrowseHeaderIconContainer } from "./BrowseHeader.styled";

export type BrowseTabId = "models" | "databases";

const isValidBrowseTab = (value: unknown): value is BrowseTabId =>
  value === "models" || value === "databases";

export const BrowseApp = ({
  tab = "models",
  children,
}: {
  tab?: string;
  children?: React.ReactNode;
}) => {
  const dispatch = useDispatch();
  const modelsResult = useSearchListQuery<SearchResult>({
    query: {
      models: ["dataset"],
      filter_items_in_personal_collection: "exclude",
    },
  });
  const databasesResult = useDatabaseListQuery();

  if (!isValidBrowseTab(tab)) {
    return <LoadingAndErrorWrapper error />;
  }

  return (
    <BrowseAppRoot data-testid="browse-data">
      <BrowseContainer data-testid="data-browser">
        <BrowseDataHeader>
          <BrowseSectionContainer>
            <h2>{t`Browse data`}</h2>
            {tab === "databases" && (
              <Flex ml="auto" justify="right" style={{ flexBasis: "40.0%" }}>
                <Link to="reference">
                  <BrowseHeaderIconContainer>
                    <Icon size={14} name="reference" />
                    <Text size="md" lh="1" fw="bold" ml=".5rem" c="inherit">
                      {t`Learn about our data`}
                    </Text>
                  </BrowseHeaderIconContainer>
                </Link>
              </Flex>
            )}
          </BrowseSectionContainer>
        </BrowseDataHeader>
        <BrowseTabs
          value={tab}
          onTabChange={value => {
            if (isValidBrowseTab(value)) {
              dispatch(push(`/browse/${value}`));
            }
          }}
        >
          <BrowseTabsList>
            <BrowseSectionContainer>
              <BrowseTab key={"models"} value={"models"}>
                {t`Models`}
              </BrowseTab>
              <BrowseTab key={"databases"} value={"databases"}>
                {t`Databases`}
              </BrowseTab>
            </BrowseSectionContainer>
          </BrowseTabsList>
          <BrowseTabsPanel key={tab} value={tab}>
            <BrowseTabsContainer>
              {children ||
                (tab === "models" ? (
                  <BrowseModels modelsResult={modelsResult} />
                ) : (
                  <BrowseDatabases databasesResult={databasesResult} />
                ))}
            </BrowseTabsContainer>
          </BrowseTabsPanel>
        </BrowseTabs>
      </BrowseContainer>
    </BrowseAppRoot>
  );
};
