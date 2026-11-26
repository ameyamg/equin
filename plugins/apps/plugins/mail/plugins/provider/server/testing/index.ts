export {
  createFakeMailProvider,
  fakeCompileQuery,
  type FakeAttachment,
  type FakeCall,
  type FakeMailProvider,
  type FakeMailProviderOptions,
  type FakeMessageInput,
} from "./fake-provider";
/** The contract's operator table, for a provider's compile test to walk (every pair must compile). */
export { MAIL_QUERY_OPS } from "../../core/internal/query";
