import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

type NotebookSummaryMarkdownProps = {
    content: string;
};

export function NotebookSummaryMarkdown({ content }: NotebookSummaryMarkdownProps) {
    return (
        <div className="prose prose-sm max-w-none whitespace-pre-wrap break-words text-slate-700 prose-a:text-emerald-600 prose-a:underline dark:prose-invert dark:text-slate-200 dark:prose-a:text-emerald-300">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                    a: ({ ...props }) => (
                        <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                        />
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
